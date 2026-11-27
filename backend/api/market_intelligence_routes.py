import asyncio
import json
import logging
import math
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import func

from database.connection import SessionLocal
from database.models import NewsArticle, MarketTradesAggregated
from api.market_flow_routes import _build_market_flow_summary_item, decimal_to_float, TIMEFRAME_MS
from api.news_routes import _parse_article_symbols

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/market-intelligence", tags=["market-intelligence"])


def _serialize_event(event_type: str, data: Dict[str, Any]) -> str:
    return f"event: {event_type}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _load_recent_news(
    db: Session,
    symbols: List[str],
    hours: int,
    limit: int,
) -> List[Dict[str, Any]]:
    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=hours)
    rows = db.query(NewsArticle).filter(
        NewsArticle.published_at >= cutoff,
    ).order_by(
        NewsArticle.published_at.desc().nullslast(),
        NewsArticle.id.desc(),
    ).limit(limit).all()

    items: List[Dict[str, Any]] = []
    symbol_set = {s.upper() for s in symbols}
    for article in rows:
        article_symbols = _parse_article_symbols(article.symbols)
        if not symbol_set.intersection(article_symbols) and "_MACRO" not in article_symbols:
            continue

        items.append({
            "id": article.id,
            "source_domain": article.source_domain,
            "source_url": article.source_url,
            "title": article.title,
            "summary": article.summary,
            "published_at": article.published_at.isoformat() if article.published_at else None,
            "symbols": article_symbols,
            "sentiment": article.sentiment,
            "ai_summary": article.ai_summary,
            "relevance_score": article.relevance_score,
            "image_url": article.image_url,
        })
    return items


def _load_large_order_zones(
    db: Session,
    symbol: str,
    exchange: str,
    timeframe: str,
    start_time: int,
    end_time: int,
) -> List[Dict[str, Any]]:
    interval_ms = TIMEFRAME_MS[timeframe]
    bucket_expr = func.floor(MarketTradesAggregated.timestamp / interval_ms) * interval_ms

    rows = db.query(
        bucket_expr.label("bucket_time"),
        func.sum(MarketTradesAggregated.large_buy_notional).label("large_buy_notional"),
        func.sum(MarketTradesAggregated.large_sell_notional).label("large_sell_notional"),
        func.sum(MarketTradesAggregated.large_buy_count).label("large_buy_count"),
        func.sum(MarketTradesAggregated.large_sell_count).label("large_sell_count"),
    ).filter(
        MarketTradesAggregated.symbol == symbol.upper(),
        MarketTradesAggregated.exchange == exchange.lower(),
        MarketTradesAggregated.timestamp >= start_time,
        MarketTradesAggregated.timestamp <= end_time,
    ).group_by(
        bucket_expr,
    ).order_by(
        bucket_expr.asc()
    ).all()

    items: List[Dict[str, Any]] = []
    for row in rows:
        large_buy_notional = decimal_to_float(row.large_buy_notional) or 0.0
        large_sell_notional = decimal_to_float(row.large_sell_notional) or 0.0
        items.append({
            "time": int(row.bucket_time),
            "large_buy_notional": large_buy_notional,
            "large_sell_notional": large_sell_notional,
            "large_order_net": large_buy_notional - large_sell_notional,
            "large_buy_count": int(row.large_buy_count or 0),
            "large_sell_count": int(row.large_sell_count or 0),
        })
    return items


def _load_snapshot(
    db: Session,
    symbol: str,
    exchange: str,
    timeframe: str,
    window: str,
    symbols: Optional[List[str]] = None,
) -> Dict[str, Any]:
    end_time = int(datetime.utcnow().timestamp() * 1000)
    analysis_start_time = end_time - TIMEFRAME_MS[window]
    chart_lookback_ms = max(TIMEFRAME_MS.get(timeframe, TIMEFRAME_MS["15m"]) * 500, TIMEFRAME_MS[window])
    chart_start_time = end_time - chart_lookback_ms
    news_hours = max(4, math.ceil(chart_lookback_ms / 3_600_000))
    news_limit = max(120, min(800, math.ceil(chart_lookback_ms / TIMEFRAME_MS.get(timeframe, TIMEFRAME_MS["15m"])) * 2))

    all_symbols = symbols if symbols else [symbol]

    # Build per-symbol summaries
    summaries: List[Dict[str, Any]] = []
    for sym in all_symbols:
        s = _build_market_flow_summary_item(
            db=db, symbol=sym.upper(), exchange=exchange.lower(),
            window=window, start_time=analysis_start_time, end_time=end_time,
        )
        if s:
            summaries.append(s)

    # Merged news across all symbols
    news_items = _load_recent_news(
        db, symbols=all_symbols, hours=news_hours, limit=news_limit,
    )

    # Zone items for primary symbol only (backward compat)
    zone_items = _load_large_order_zones(
        db=db, symbol=symbol, exchange=exchange,
        timeframe=timeframe, start_time=chart_start_time, end_time=end_time,
    )

    latest_news_at = next((item.get("published_at") for item in news_items if item.get("published_at")), None)
    # Single-symbol backward compat
    summary = summaries[0] if len(summaries) == 1 and not symbols else (summaries[0] if summaries else None)
    flow_updated_at = None
    if isinstance(summary, dict):
        flow_updated_at = summary.get("latest_trade_timestamp")

    result: Dict[str, Any] = {
        "exchange": exchange.lower(),
        "symbol": symbol.upper(),
        "timeframe": timeframe,
        "window": window,
        "generated_at": end_time,
        "analysis_window": window,
        "chart_lookback_start": chart_start_time,
        "flow_updated_at": flow_updated_at,
        "latest_news_at": latest_news_at,
        "summary": summary,
        "news_items": news_items,
        "zone_items": zone_items,
    }
    if symbols:
        result["symbols"] = [s.upper() for s in symbols]
        result["summaries"] = summaries
    return result


def _snapshot_signature(snapshot: Dict[str, Any]) -> Dict[str, Any]:
    news_sig = [
        (item["id"], item.get("published_at"), item.get("title"))
        for item in snapshot["news_items"][:60]
    ]
    zone_sig = [
        (item["time"], item["large_order_net"], item["large_buy_count"], item["large_sell_count"])
        for item in snapshot["zone_items"][-60:]
    ]
    # Handle both single summary and multi-symbol summaries
    summaries = snapshot.get("summaries") or []
    if summaries:
        summary_sig = tuple(
            (s.get("symbol"), s.get("latest_trade_timestamp"), s.get("net_inflow"),
             s.get("large_order_net"), s.get("buy_ratio"))
            for s in summaries
        )
    else:
        summary = snapshot["summary"] or {}
        summary_sig = (
            summary.get("latest_trade_timestamp"),
            summary.get("net_inflow"),
            summary.get("large_order_net"),
            summary.get("buy_ratio"),
            summary.get("open_interest_change_pct"),
            summary.get("funding_rate_pct"),
        )
    return {
        "news": news_sig,
        "zones": zone_sig,
        "summary": summary_sig,
    }


@router.get("/stream")
async def stream_market_intelligence(
    request: Request,
    symbol: str = Query("BTC", description="Trading symbol, e.g. BTC"),
    symbols: Optional[str] = Query(None, description="Comma-separated symbols, e.g. BTC,ETH,SOL"),
    exchange: str = Query("hyperliquid", description="Exchange: hyperliquid or binance"),
    timeframe: str = Query("15m", description="Chart timeframe"),
    window: str = Query("4h", description="Analysis window"),
):
    if timeframe not in TIMEFRAME_MS:
        return StreamingResponse(iter(["event: error\ndata: {\"message\":\"invalid timeframe\"}\n\n"]), media_type="text/event-stream")
    if window != "4h":
        window = "4h"
    if exchange.lower() not in {"hyperliquid", "binance"}:
        return StreamingResponse(iter(["event: error\ndata: {\"message\":\"invalid exchange\"}\n\n"]), media_type="text/event-stream")

    # Parse multi-symbol list
    symbols_list: Optional[List[str]] = None
    if symbols:
        symbols_list = [s.strip().upper() for s in symbols.split(",") if s.strip()]
        if not symbols_list:
            symbols_list = None

    async def event_generator():
        previous_sig: Optional[Dict[str, Any]] = None
        previous_snapshot: Optional[Dict[str, Any]] = None
        heartbeat_count = 0

        while True:
            if await request.is_disconnected():
                break

            db = SessionLocal()
            try:
                snapshot = _load_snapshot(
                    db=db,
                    symbol=symbol,
                    exchange=exchange,
                    timeframe=timeframe,
                    window=window,
                    symbols=symbols_list,
                )
            except Exception as exc:
                logger.error("Market intelligence stream snapshot failed: %s", exc, exc_info=True)
                yield _serialize_event("error", {"message": str(exc)})
                db.close()
                break
            finally:
                db.close()

            signature = _snapshot_signature(snapshot)
            if previous_sig is None:
                previous_sig = signature
                previous_snapshot = snapshot
                yield _serialize_event("snapshot", snapshot)
            else:
                changed_parts: List[str] = []
                if signature["news"] != previous_sig["news"]:
                    changed_parts.append("news")
                if signature["zones"] != previous_sig["zones"]:
                    changed_parts.append("flow")
                if signature["summary"] != previous_sig["summary"] and "flow" not in changed_parts:
                    changed_parts.append("summary")

                if changed_parts:
                    previous_sig = signature
                    previous_snapshot = snapshot
                    yield _serialize_event("update", {
                        "changes": changed_parts,
                        **snapshot,
                    })
                else:
                    heartbeat_count += 1
                    if heartbeat_count >= 5:
                        heartbeat_count = 0
                        yield _serialize_event("heartbeat", {
                            "exchange": exchange.lower(),
                            "symbol": symbol.upper(),
                            "timeframe": timeframe,
                            "window": window,
                            "generated_at": snapshot["generated_at"],
                            "latest_trade_timestamp": snapshot["summary"].get("latest_trade_timestamp") if snapshot.get("summary") else None,
                        })

            await asyncio.sleep(3)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
