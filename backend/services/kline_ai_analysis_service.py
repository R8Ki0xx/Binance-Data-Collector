"""
K-line AI Analysis Service - Handles AI-powered chart analysis
"""
import logging
import json
import time
import random
from datetime import datetime
from typing import Any, Dict, List, Optional

import requests
from sqlalchemy.orm import Session

from database.models import Account, KlineAIAnalysisLog
from config.prompt_templates import KLINE_ANALYSIS_PROMPT_TEMPLATE
from services.ai_decision_service import build_chat_completion_endpoints, _extract_text_from_message, get_max_tokens, build_llm_payload, build_llm_headers, is_reasoning_model
from services.market_flow_indicators import get_flow_indicators_for_prompt


logger = logging.getLogger(__name__)


class SafeDict(dict):
    """Dictionary that returns 'N/A' for missing keys"""
    def __missing__(self, key):
        return "N/A"


def _format_klines_summary(klines: List[Dict]) -> str:
    """Format K-line data into a readable summary"""
    if not klines:
        return "No K-line data available."

    lines = []
    # Take last N candles for summary (most recent)
    recent_klines = klines

    lines.append(f"Displaying last {len(recent_klines)} candles (oldest to newest):")
    lines.append("")

    for i, kline in enumerate(recent_klines):
        timestamp = kline.get('timestamp') or kline.get('time', 'N/A')
        if isinstance(timestamp, (int, float)):
            try:
                dt = datetime.utcfromtimestamp(timestamp)
                time_str = dt.strftime('%Y-%m-%d %H:%M')
            except:
                time_str = str(timestamp)
        elif kline.get('datetime'):
            # If datetime string is available, use it
            time_str = str(kline.get('datetime'))[:16]
        else:
            time_str = 'N/A'

        open_price = kline.get('open') or 0
        high = kline.get('high') or 0
        low = kline.get('low') or 0
        close = kline.get('close') or 0
        volume = kline.get('volume') or 0

        # Determine candle direction
        direction = "+" if close >= open_price else "-"
        change_pct = ((close - open_price) / open_price * 100) if open_price > 0 else 0

        lines.append(
            f"[{time_str}] O:{open_price:.2f} H:{high:.2f} L:{low:.2f} C:{close:.2f} "
            f"({direction}{abs(change_pct):.2f}%) Vol:{volume:,.0f}"
        )

    # Add summary statistics
    if len(klines) >= 2:
        first_close = klines[0].get('close') or 0
        last_close = klines[-1].get('close') or 0
        highest = max((k.get('high') or 0) for k in klines)
        lowest = min((k.get('low') or float('inf')) for k in klines)
        total_volume = sum((k.get('volume') or 0) for k in klines)

        if first_close > 0:
            period_change = ((last_close - first_close) / first_close) * 100
            lines.append("")
            lines.append(f"--- Period Summary ---")
            lines.append(f"Period Change: {period_change:+.2f}%")
            lines.append(f"High/Low Range: ${lowest:.2f} - ${highest:.2f}")
            lines.append(f"Total Volume: {total_volume:,.0f}")

    return "\n".join(lines)


def _format_positions_summary(positions: List[Dict]) -> str:
    """Format positions into a readable summary"""
    if not positions:
        return "No open positions."

    lines = []
    for p in positions:
        symbol = p.get("symbol") or "N/A"
        side = (p.get("side") or "").upper()
        size = p.get("size", "N/A")
        value = p.get("position_value", "N/A")
        entry = p.get("entry_price", "N/A")
        mark = p.get("mark_price", "N/A")
        liq = p.get("liquidation_price", "N/A")
        leverage = p.get("leverage", "N/A")
        pnl = p.get("unrealized_pnl", "N/A")
        pnl_pct = p.get("pnl_percentage", None)

        line_parts = [
            f"{symbol} {side} size:{size}",
            f"value:{value}",
            f"entry:{entry}",
            f"mark:{mark}",
            f"liq:{liq}",
            f"lev:{leverage}",
            f"unrealized_pnl:{pnl}",
        ]
        if pnl_pct is not None:
            line_parts.append(f"pnl%:{pnl_pct}")

        lines.append(" | ".join(line_parts))

    return "\n".join(lines)


def _format_indicators_summary(indicators: Dict[str, Any]) -> str:
    """Format technical indicators into a readable summary"""
    if not indicators:
        return "No technical indicators available."

    lines = []
    tail_len = 5

    # Moving Averages
    ma_indicators = []
    for key in ['MA5', 'MA10', 'MA20', 'EMA20', 'EMA50']:
        if key in indicators and indicators[key]:
            values = indicators[key]
            if isinstance(values, list) and len(values) > 0:
                latest = values[-1] if values[-1] is not None else 'N/A'
                ma_indicators.append(f"{key}: ${latest:.2f}" if isinstance(latest, (int, float)) else f"{key}: {latest}")
                # 最近序列
                tail_values = [v for v in values[-tail_len:] if isinstance(v, (int, float, float))]
                if tail_values:
                    ma_indicators.append(f"{key} last {len(tail_values)}: {', '.join(f'{v:.2f}' for v in tail_values)}")

    if ma_indicators:
        lines.append("**Moving Averages:**")
        lines.append(", ".join(ma_indicators))
        lines.append("")

    # RSI
    rsi_values = []
    for key in ['RSI14', 'RSI7']:
        if key in indicators and indicators[key]:
            values = indicators[key]
            if isinstance(values, list) and len(values) > 0:
                latest = values[-1] if values[-1] is not None else 'N/A'
                if isinstance(latest, (int, float)):
                    status = "Overbought" if latest > 70 else "Oversold" if latest < 30 else "Neutral"
                    rsi_values.append(f"{key}: {latest:.2f} ({status})")

    if rsi_values:
        lines.append("**RSI (Relative Strength Index):**")
        lines.extend(rsi_values)
        lines.append("")

    # MACD
    if 'MACD' in indicators and indicators['MACD']:
        macd_data = indicators['MACD']
        if isinstance(macd_data, dict):
            macd_line = macd_data.get('macd', [])
            signal_line = macd_data.get('signal', [])
            histogram = macd_data.get('histogram', [])

            lines.append("**MACD:**")
            if macd_line and len(macd_line) > 0 and macd_line[-1] is not None:
                lines.append(f"MACD Line: {macd_line[-1]:.4f}")
            if signal_line and len(signal_line) > 0 and signal_line[-1] is not None:
                lines.append(f"Signal Line: {signal_line[-1]:.4f}")
            if histogram and len(histogram) > 0 and histogram[-1] is not None:
                hist_val = histogram[-1]
                trend = "Bullish momentum" if hist_val > 0 else "Bearish momentum"
                lines.append(f"Histogram: {hist_val:.4f} ({trend})")
                tail_hist = [v for v in histogram[-tail_len:] if isinstance(v, (int, float, float))]
                if tail_hist:
                    lines.append(f"Histogram last {len(tail_hist)}: {', '.join(f'{v:.4f}' for v in tail_hist)}")
            lines.append("")

    # Bollinger Bands
    if 'BOLL' in indicators and indicators['BOLL']:
        boll_data = indicators['BOLL']
        if isinstance(boll_data, dict):
            upper = boll_data.get('upper', [])
            middle = boll_data.get('middle', [])
            lower = boll_data.get('lower', [])

            lines.append("**Bollinger Bands:**")
            if upper and len(upper) > 0 and upper[-1] is not None:
                lines.append(f"Upper Band: ${upper[-1]:.2f}")
            if middle and len(middle) > 0 and middle[-1] is not None:
                lines.append(f"Middle Band (SMA20): ${middle[-1]:.2f}")
            if lower and len(lower) > 0 and lower[-1] is not None:
                lines.append(f"Lower Band: ${lower[-1]:.2f}")
            lines.append("")

    # ATR
    if 'ATR14' in indicators and indicators['ATR14']:
        values = indicators['ATR14']
        if isinstance(values, list) and len(values) > 0 and values[-1] is not None:
            lines.append("**ATR (Average True Range):**")
            lines.append(f"ATR14: ${values[-1]:.2f} (volatility indicator)")
            lines.append("")

    if not lines:
        return "No technical indicators selected."

    return "\n".join(lines)


def _format_flow_indicators_summary(
    db: Session,
    symbol: str,
    period: str,
    selected_flow_indicators: List[str],
    exchange: str = "hyperliquid"
) -> str:
    """Format market flow indicators into a readable summary for AI analysis.

    Fetches data from database using get_flow_indicators_for_prompt.
    """
    if not selected_flow_indicators:
        return ""

    # Map frontend indicator keys to backend indicator names
    key_mapping = {
        'cvd': 'CVD',
        'taker_volume': 'TAKER',
        'oi': 'OI',
        'oi_delta': 'OI_DELTA',
        'funding': 'FUNDING',
        'depth_ratio': 'DEPTH',
        'order_imbalance': 'IMBALANCE',
    }

    # Convert frontend keys to backend indicator names
    backend_indicators = [key_mapping.get(k, k.upper()) for k in selected_flow_indicators]

    # Fetch flow indicator data from database
    try:
        flow_data = get_flow_indicators_for_prompt(db, symbol, period, backend_indicators, exchange=exchange)
    except Exception as e:
        logger.error(f"Failed to fetch flow indicators: {e}")
        return ""

    if not flow_data:
        return ""

    lines = []
    lines.append("**Market Flow Indicators:**")

    # Format each indicator
    for frontend_key in selected_flow_indicators:
        backend_key = key_mapping.get(frontend_key, frontend_key.upper())
        data = flow_data.get(backend_key)

        if not data:
            continue

        if backend_key == 'CVD':
            cvd_val = data.get('current')
            if cvd_val is not None:
                lines.append(f"- CVD (Cumulative Volume Delta): {_format_volume(cvd_val)}")
                history = data.get('last_5', [])
                if history:
                    hist_str = ', '.join(_format_volume(v) for v in history)
                    lines.append(f"  CVD last {len(history)}: {hist_str}")
                cumulative = data.get('cumulative')
                if cumulative is not None:
                    lines.append(f"  Cumulative: {_format_volume(cumulative)}")

        elif backend_key == 'TAKER':
            buy = data.get('buy')
            sell = data.get('sell')
            ratio = data.get('ratio')
            if buy is not None and sell is not None:
                lines.append(f"- Taker Buy: {_format_volume(buy)} | Taker Sell: {_format_volume(sell)}")
                if ratio is not None:
                    lines.append(f"  Buy/Sell Ratio: {ratio:.2f}")

        elif backend_key == 'OI':
            oi_val = data.get('current')
            if oi_val is not None:
                lines.append(f"- Open Interest: {_format_volume(oi_val)}")
                history = data.get('last_5', [])
                if history:
                    hist_str = ', '.join(_format_volume(v) for v in history)
                    lines.append(f"  OI last {len(history)}: {hist_str}")

        elif backend_key == 'OI_DELTA':
            delta = data.get('current')
            if delta is not None:
                lines.append(f"- OI Delta ({period}): {delta:+.2f}%")
                history = data.get('last_5', [])
                if history:
                    hist_str = ', '.join(f"{v:+.2f}%" for v in history)
                    lines.append(f"  OI Delta last {len(history)}: {hist_str}")

        elif backend_key == 'FUNDING':
            rate = data.get('current')
            if rate is not None:
                lines.append(f"- Funding Rate: {rate:.4f}%")
                annualized = data.get('annualized')
                if annualized is not None:
                    lines.append(f"  Annualized: {annualized:.2f}%")
                history = data.get('last_5', [])
                if history:
                    hist_str = ', '.join(f"{v:.4f}%" for v in history)
                    lines.append(f"  Funding last {len(history)}: {hist_str}")

        elif backend_key == 'DEPTH':
            ratio = data.get('ratio')
            bid = data.get('bid')
            ask = data.get('ask')
            if ratio is not None:
                lines.append(f"- Depth Ratio (Bid/Ask): {ratio:.2f}")
                if bid is not None and ask is not None:
                    lines.append(f"  Bid Depth: {_format_volume(bid)} | Ask Depth: {_format_volume(ask)}")
                spread = data.get('spread')
                if spread is not None:
                    lines.append(f"  Spread: {spread:.4f}")

        elif backend_key == 'IMBALANCE':
            imb = data.get('current')
            if imb is not None:
                lines.append(f"- Order Imbalance: {imb:+.3f}")
                history = data.get('last_5', [])
                if history:
                    hist_str = ', '.join(f"{v:+.3f}" for v in history)
                    lines.append(f"  Imbalance last {len(history)}: {hist_str}")

    if len(lines) <= 1:
        return ""

    lines.append("")
    return "\n".join(lines)


def _format_volume(value: float) -> str:
    """Format volume with appropriate unit (K, M, B)"""
    if value is None:
        return "N/A"
    abs_val = abs(value)
    sign = "+" if value >= 0 else "-"
    if abs_val >= 1_000_000_000:
        return f"{sign}${abs_val/1_000_000_000:.2f}B"
    elif abs_val >= 1_000_000:
        return f"{sign}${abs_val/1_000_000:.2f}M"
    elif abs_val >= 1_000:
        return f"{sign}${abs_val/1_000:.2f}K"
    else:
        return f"{sign}${abs_val:.2f}"


def analyze_kline_chart(
    db: Session,
    account: Account,
    symbol: str,
    period: str,
    klines: List[Dict],
    indicators: Dict[str, Any],
    market_data: Dict[str, Any],
    user_message: Optional[str] = None,
    positions: List[Dict[str, Any]] = None,
    kline_limit: Optional[int] = None,
    user_id: int = 1,
    selected_flow_indicators: List[str] = None,
    exchange: str = "hyperliquid",
) -> Optional[Dict[str, Any]]:
    """
    Perform AI analysis on K-line chart data

    Args:
        db: Database session
        account: AI Trader account with model configuration
        symbol: Trading symbol (e.g., 'BTC')
        period: K-line period (e.g., '1m', '1h', '1d')
        klines: List of K-line data points
        indicators: Dictionary of technical indicators
        market_data: Current market data (price, volume, etc.)
        user_message: Optional custom question from user
        user_id: User ID for logging

    Returns:
        Dictionary with analysis result or None if failed
    """
    analysis_start = time.time()
    logger.info(f"[K-line Analysis] Starting analysis: symbol={symbol}, period={period}, "
               f"account={account.name}, model={account.model}, klines={len(klines)}, "
               f"user_message={'Yes' if user_message else 'No'}")

    if not account.api_key or account.api_key in ["", "default-key-please-update-in-settings", "default"]:
        logger.info(f"[K-line Analysis] Account {account.name} has no valid API key")
        return {"error": "AI Trader has no valid API key configured"}

    try:
        # Build prompt context
        logger.info(f"[K-line Analysis] Building prompt context...")
        now = datetime.utcnow()

        # respect kline_limit if provided
        display_klines = klines[-kline_limit:] if kline_limit else klines

        klines_summary = _format_klines_summary(display_klines)
        indicators_summary = _format_indicators_summary(indicators)
        positions_summary = _format_positions_summary(positions or [])
        flow_indicators_summary = _format_flow_indicators_summary(
            db, symbol, period, selected_flow_indicators or [], exchange=exchange
        )

        context = {
            "symbol": symbol,
            "exchange": exchange,
            "period": period,
            "current_time_utc": now.isoformat() + "Z",
            "current_price": market_data.get("price", "N/A"),
            "change_24h": f"{market_data.get('percentage24h', 0):.2f}",
            "volume_24h": f"{market_data.get('volume24h', 0):,.0f}",
            "open_interest": f"{market_data.get('open_interest', 0):,.0f}",
            "funding_rate": f"{market_data.get('funding_rate', 0) * 100:.4f}",
            "kline_count": len(display_klines),
            "klines_summary": klines_summary,
            "indicators_summary": indicators_summary,
            "flow_indicators_summary": flow_indicators_summary,
            "positions_summary": positions_summary,
            "user_message": user_message if user_message else "No specific question provided. Please provide a general analysis.",
            "additional_instructions": "",
        }

        # Render prompt
        try:
            prompt = KLINE_ANALYSIS_PROMPT_TEMPLATE.format_map(SafeDict(context))
        except Exception as e:
            logger.error(f"Failed to render prompt: {e}")
            prompt = KLINE_ANALYSIS_PROMPT_TEMPLATE

    # Build API request
        # Use unified headers/payload builders (see build_llm_payload in ai_decision_service)
        headers = build_llm_headers("openai", account.api_key)

        payload = build_llm_payload(
            model=account.model,
            messages=[{"role": "user", "content": prompt}],
            api_format="openai",
        )

        # Call AI API
        endpoints = build_chat_completion_endpoints(account.base_url, account.model)
        if not endpoints:
            logger.error(f"No valid API endpoint for account {account.name}")
            return {"error": "Failed to build API endpoint"}

        max_retries = 3
        response = None
        success = False
        request_timeout = 600  # 10 minutes for all models (reasoning models can be very slow)

        logger.info(f"[K-line AI API] Starting AI API call: model={account.model}, timeout={request_timeout}s, "
                   f"endpoints={len(endpoints)}, max_retries={max_retries}")

        for endpoint_idx, endpoint in enumerate(endpoints):
            logger.info(f"[K-line AI API] Trying endpoint {endpoint_idx + 1}/{len(endpoints)}: {endpoint}")

            for attempt in range(max_retries):
                try:
                    api_start = time.time()
                    logger.info(f"[K-line AI API] Sending request (attempt {attempt + 1}/{max_retries})...")

                    response = requests.post(
                        endpoint,
                        headers=headers,
                        json=payload,
                        timeout=request_timeout,
                        verify=False,
                    )

                    api_elapsed = time.time() - api_start
                    logger.info(f"[K-line AI API] Received response in {api_elapsed:.2f}s: status={response.status_code}, "
                               f"content_length={len(response.content) if response.content else 0}")

                    if response.status_code == 200:
                        success = True
                        logger.info(f"[K-line AI API] Success! Total API time: {api_elapsed:.2f}s")
                        break

                    if response.status_code == 429:
                        wait_time = (2**attempt) + random.uniform(0, 1)
                        logger.info(f"[K-line AI API] Rate limited (429), waiting {wait_time:.1f}s...")
                        if attempt < max_retries - 1:
                            time.sleep(wait_time)
                            continue

                    logger.info(f"[K-line AI API] API returned error status {response.status_code}: {response.text[:200]}")
                    break

                except requests.Timeout as e:
                    api_elapsed = time.time() - api_start
                    logger.error(f"[K-line AI API] Request timeout after {api_elapsed:.2f}s (configured: {request_timeout}s): {e}")
                    if attempt < max_retries - 1:
                        wait_time = (2**attempt) + random.uniform(0, 1)
                        logger.info(f"[K-line AI API] Retrying in {wait_time:.1f}s...")
                        time.sleep(wait_time)
                        continue
                    logger.error(f"[K-line AI API] Timeout after {max_retries} attempts")
                    break

                except requests.RequestException as e:
                    api_elapsed = time.time() - api_start
                    logger.error(f"[K-line AI API] Request failed after {api_elapsed:.2f}s: {type(e).__name__}: {e}")
                    if attempt < max_retries - 1:
                        wait_time = (2**attempt) + random.uniform(0, 1)
                        logger.info(f"[K-line AI API] Retrying in {wait_time:.1f}s...")
                        time.sleep(wait_time)
                        continue
                    logger.error(f"[K-line AI API] Failed after {max_retries} attempts")
                    break

            if success:
                break

        if not success or not response:
            logger.error(f"[K-line AI API] All API endpoints failed for account {account.name}")
            return {"error": "AI API request failed"}

        # Parse response
        result = response.json()

        if "choices" in result and len(result["choices"]) > 0:
            choice = result["choices"][0]
            message = choice.get("message", {})
            raw_content = message.get("content")

            analysis_text = _extract_text_from_message(raw_content)

            if not analysis_text:
                logger.error("Empty content in AI response")
                return {"error": "AI returned empty response"}

            # Save to database
            analysis_log = KlineAIAnalysisLog(
                user_id=user_id,
                account_id=account.id,
                symbol=symbol,
                period=period,
                user_message=user_message,
                model_used=account.model,
                prompt_snapshot=prompt,
                analysis_result=analysis_text,
            )

            db.add(analysis_log)
            db.commit()
            db.refresh(analysis_log)

            total_elapsed = time.time() - analysis_start
            logger.info(f"[K-line Analysis] Analysis completed successfully in {total_elapsed:.2f}s: "
                       f"symbol={symbol}, period={period}, account={account.name}, analysis_id={analysis_log.id}")

            return {
                "success": True,
                "analysis_id": analysis_log.id,
                "symbol": symbol,
                "period": period,
                "model": account.model,
                "trader_name": account.name,
                "analysis": analysis_text,
                "created_at": analysis_log.created_at.isoformat() if analysis_log.created_at else None,
                "prompt": prompt,
            }

        logger.error(f"[K-line Analysis] Unexpected AI response format: {result}")
        return {"error": "Unexpected AI response format"}

    except Exception as e:
        elapsed = time.time() - analysis_start
        logger.error(f"[K-line Analysis] Analysis failed after {elapsed:.2f}s: {type(e).__name__}: {e}", exc_info=True)
        return {"error": f"Analysis failed: {str(e)}"}


def get_analysis_history(
    db: Session,
    user_id: int,
    symbol: Optional[str] = None,
    limit: int = 20,
) -> List[Dict[str, Any]]:
    """Get K-line analysis history for a user"""
    query = db.query(KlineAIAnalysisLog).filter(
        KlineAIAnalysisLog.user_id == user_id
    )

    if symbol:
        query = query.filter(KlineAIAnalysisLog.symbol == symbol)

    logs = query.order_by(KlineAIAnalysisLog.created_at.desc()).limit(limit).all()

    return [
        {
            "id": log.id,
            "symbol": log.symbol,
            "period": log.period,
            "model_used": log.model_used,
            "user_message": log.user_message,
            "analysis": log.analysis_result,
            "created_at": log.created_at.isoformat() if log.created_at else None,
        }
        for log in logs
    ]
