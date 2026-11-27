"""System configuration and data management API routes"""

import logging
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session
from pydantic import BaseModel

from database.connection import get_db
from database.models import SystemConfig

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/system", tags=["system"])

# Config keys
HYPERLIQUID_RETENTION_KEY = "hyperliquid_retention_days"
BINANCE_RETENTION_KEY = "binance_retention_days"
DEFAULT_RETENTION_DAYS = 365


class RetentionDaysRequest(BaseModel):
    days: int
    exchange: str = "hyperliquid"


class RetentionDaysResponse(BaseModel):
    days: int
    exchange: str = "hyperliquid"


def get_retention_key(exchange: str) -> str:
    """Get the config key for a specific exchange"""
    if exchange == "binance":
        return BINANCE_RETENTION_KEY
    return HYPERLIQUID_RETENTION_KEY


def get_retention_days(db: Session, exchange: str = "hyperliquid") -> int:
    """Get configured retention days from SystemConfig for specific exchange"""
    key = get_retention_key(exchange)
    config = db.query(SystemConfig).filter(SystemConfig.key == key).first()
    if config and config.value:
        try:
            return int(config.value)
        except ValueError:
            pass
    return DEFAULT_RETENTION_DAYS


def set_retention_days(db: Session, days: int, exchange: str = "hyperliquid") -> int:
    """Set retention days in SystemConfig for specific exchange"""
    key = get_retention_key(exchange)
    config = db.query(SystemConfig).filter(SystemConfig.key == key).first()
    if config:
        config.value = str(days)
    else:
        config = SystemConfig(
            key=key,
            value=str(days),
            description=f"{exchange.capitalize()} market data retention period in days"
        )
        db.add(config)
    db.commit()
    return days


@router.get("/storage-stats")
def get_storage_stats(exchange: str = "hyperliquid", db: Session = Depends(get_db)):
    """Get storage statistics for market flow data tables by exchange"""
    try:
        # Tables with exchange column
        tables_with_exchange = [
            'market_trades_aggregated',
            'market_asset_metrics',
            'market_orderbook_snapshots',
            'crypto_klines'
        ]
        if exchange == "binance":
            tables_with_exchange.append('market_sentiment_metrics')

        tables = {}
        total_bytes = 0

        for table_name in tables_with_exchange:
            try:
                # Get total table size (including indexes)
                size_query = text("""
                    SELECT pg_total_relation_size(relid) as total_bytes
                    FROM pg_catalog.pg_statio_user_tables
                    WHERE relname = :table_name
                """)
                table_size = db.execute(size_query, {"table_name": table_name}).scalar() or 0

                # Get row ratio for this exchange
                ratio_query = text(f"""
                    SELECT
                        COALESCE(
                            (SELECT COUNT(*)::float FROM {table_name} WHERE exchange = :exchange) /
                            NULLIF((SELECT COUNT(*)::float FROM {table_name}), 0),
                            0
                        )
                """)
                ratio = db.execute(ratio_query, {"exchange": exchange}).scalar() or 0

                # Calculate this exchange's share of the table
                exchange_bytes = int(table_size * ratio)
                tables[table_name] = round(exchange_bytes / (1024 * 1024), 1)
                total_bytes += exchange_bytes
            except Exception as e:
                logger.warning(f"Failed to get stats for {table_name}: {e}")
                tables[table_name] = 0

        total_mb = round(total_bytes / (1024 * 1024), 1)
        retention_days = get_retention_days(db, exchange)

        # Get symbol count and date range for estimation
        count_query = text("""
            SELECT
                COUNT(DISTINCT symbol) as symbol_count,
                MIN(timestamp) as min_ts,
                MAX(timestamp) as max_ts
            FROM market_trades_aggregated
            WHERE exchange = :exchange
        """)
        count_result = db.execute(count_query, {"exchange": exchange}).fetchone()
        symbol_count = count_result[0] or 1
        min_ts = count_result[1]
        max_ts = count_result[2]

        # Calculate per-symbol-per-day estimate
        if min_ts and max_ts and total_mb > 0:
            days_of_data = max((max_ts - min_ts) / (1000 * 86400), 1)
            per_symbol_per_day = total_mb / (symbol_count * days_of_data)
        else:
            per_symbol_per_day = 6.7  # fallback estimate

        return {
            "exchange": exchange,
            "total_size_mb": total_mb,
            "tables": tables,
            "retention_days": retention_days,
            "symbol_count": symbol_count,
            "estimated_per_symbol_per_day_mb": round(per_symbol_per_day, 2)
        }
    except Exception as e:
        logger.error(f"Failed to get storage stats: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/data-coverage")
def get_data_coverage(
    days: int = 30,
    symbol: str = None,
    tz_offset: int = 0,
    exchange: str = "hyperliquid",
    data_type: str = "market_flow",
    db: Session = Depends(get_db)
):
    """Get data coverage heatmap for market data.
    If symbol is provided, returns coverage for that symbol only.
    If symbol is not provided, returns list of available symbols.
    tz_offset: timezone offset in minutes (e.g., -480 for UTC+8)
    exchange: hyperliquid or binance
    data_type: market_flow or klines
    """
    try:
        import time
        now_ts = int(time.time())

        # Determine table and timestamp handling based on data_type
        # crypto_klines uses seconds, market_trades_aggregated uses milliseconds
        if data_type == "klines":
            table_name = "crypto_klines"
            symbol_filter = "1=1"  # Include all periods for coverage calculation
            start_ts = now_ts - (days * 24 * 60 * 60)  # seconds
            ts_divisor = 1  # already in seconds
        else:
            table_name = "market_trades_aggregated"
            symbol_filter = "1=1"
            start_ts = now_ts * 1000 - (days * 24 * 60 * 60 * 1000)  # milliseconds
            ts_divisor = 1000  # convert to seconds for to_timestamp

        # If no symbol specified, return available symbols list
        if not symbol:
            symbols_query = text(f"""
                SELECT DISTINCT symbol FROM {table_name}
                WHERE timestamp >= :start_ts AND exchange = :exchange AND {symbol_filter}
                ORDER BY symbol
            """)
            result = db.execute(symbols_query, {"start_ts": start_ts, "exchange": exchange})
            symbols = [row[0] for row in result.fetchall()]
            return {"symbols": symbols, "exchange": exchange, "data_type": data_type}

        # Convert tz_offset from minutes to interval string
        offset_minutes = -tz_offset
        offset_interval = f"{offset_minutes} minutes"

        # Query hourly coverage
        coverage_query = text(f"""
            SELECT
                to_char(to_timestamp(timestamp / {ts_divisor}) + interval :tz_interval, 'YYYY-MM-DD') as date,
                COUNT(DISTINCT to_char(to_timestamp(timestamp / {ts_divisor}) + interval :tz_interval, 'HH24')) as hours_with_data
            FROM {table_name}
            WHERE timestamp >= :start_ts AND symbol = :symbol AND exchange = :exchange AND {symbol_filter}
            GROUP BY to_char(to_timestamp(timestamp / {ts_divisor}) + interval :tz_interval, 'YYYY-MM-DD')
            ORDER BY date
        """)
        result = db.execute(coverage_query, {
            "start_ts": start_ts,
            "symbol": symbol.upper(),
            "tz_interval": offset_interval,
            "exchange": exchange
        })
        rows = result.fetchall()

        # Build coverage list
        coverage_map = {}
        for row in rows:
            date_str = row[0]
            hours = row[1]
            coverage_pct = min(100, round(hours / 24 * 100))
            coverage_map[date_str] = coverage_pct

        # Generate date list
        from datetime import timezone as tz
        local_offset = timedelta(minutes=offset_minutes)
        local_tz = tz(local_offset)
        end_date = datetime.now(local_tz).date()
        start_date = end_date - timedelta(days=days - 1)
        coverage = []
        current = start_date
        while current <= end_date:
            date_str = current.strftime("%Y-%m-%d")
            coverage.append({
                "date": date_str,
                "pct": coverage_map.get(date_str, 0)
            })
            current += timedelta(days=1)

        return {
            "symbol": symbol.upper(),
            "days": days,
            "coverage": coverage,
            "exchange": exchange,
            "data_type": data_type
        }
    except Exception as e:
        logger.error(f"Failed to get data coverage: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/retention-days")
def get_retention_days_api(exchange: str = "hyperliquid", db: Session = Depends(get_db)):
    """Get current retention days setting for specific exchange"""
    days = get_retention_days(db, exchange)
    return RetentionDaysResponse(days=days, exchange=exchange)


@router.put("/retention-days")
def update_retention_days(request: RetentionDaysRequest, db: Session = Depends(get_db)):
    """Update retention days setting for specific exchange"""
    if request.days < 7 or request.days > 730:
        raise HTTPException(status_code=400, detail="Retention days must be between 7 and 730")

    days = set_retention_days(db, request.days, request.exchange)
    logger.info(f"Updated {request.exchange} retention to {days} days")

    return RetentionDaysResponse(days=days, exchange=request.exchange)


@router.get("/collection-days")
def get_collection_days(exchange: str = "hyperliquid", db: Session = Depends(get_db)):
    """Get total days of market flow data collection for specific exchange.
    Calculated from earliest record timestamp to now.
    """
    try:
        import time
        query = text("SELECT MIN(timestamp) FROM market_trades_aggregated WHERE exchange = :exchange")
        result = db.execute(query, {"exchange": exchange}).scalar()

        if not result:
            return {"days": 0, "exchange": exchange}

        now_ms = int(time.time() * 1000)
        days = (now_ms - result) / (24 * 60 * 60 * 1000)
        return {"days": round(days, 1), "exchange": exchange}
    except Exception as e:
        logger.error(f"Failed to get collection days: {e}")
        return {"days": 0, "exchange": exchange}


# ==================== Binance Backfill ====================

@router.post("/binance/backfill")
async def start_binance_backfill(
    force: bool = False,
    db: Session = Depends(get_db)
):
    """Start Binance historical data backfill task.
    Uses current Binance watchlist symbols.
    Backfills: K-lines (1500), OI (30d), Funding (365d), Sentiment (30d).

    Args:
        force: If True, cancel any running/pending tasks and start fresh
    """
    from database.models import BinanceBackfillTask
    from services.binance_symbol_service import get_selected_symbols as get_binance_selected_symbols
    from services.exchanges.binance_backfill import binance_backfill_service
    import asyncio

    # Check if already running
    running_task = db.query(BinanceBackfillTask).filter(
        BinanceBackfillTask.status.in_(["pending", "running"])
    ).first()

    if running_task:
        if force:
            # Cancel all running/pending tasks
            db.query(BinanceBackfillTask).filter(
                BinanceBackfillTask.status.in_(["pending", "running"])
            ).update({"status": "cancelled"})
            db.commit()
        else:
            raise HTTPException(status_code=400, detail="A backfill task is already running")

    # Get Binance watchlist symbols
    symbols = get_binance_selected_symbols()
    if not symbols:
        symbols = ["BTC"]
    logger.info(f"[Binance] Starting backfill with symbols: {symbols}")

    # Create task
    task = BinanceBackfillTask(
        symbols=",".join(symbols),
        status="pending",
        progress=0
    )
    db.add(task)
    db.commit()
    db.refresh(task)

    # Start backfill in background
    asyncio.create_task(binance_backfill_service.start_backfill(task.id))

    return {
        "task_id": task.id,
        "symbols": symbols,
        "status": "started"
    }


@router.get("/binance/backfill/status")
def get_binance_backfill_status(db: Session = Depends(get_db)):
    """Get current Binance backfill task status."""
    from database.models import BinanceBackfillTask

    # Get most recent task
    task = db.query(BinanceBackfillTask).order_by(
        BinanceBackfillTask.created_at.desc()
    ).first()

    if not task:
        return {"status": "none", "progress": 0}

    return {
        "task_id": task.id,
        "symbols": task.symbols.split(",") if task.symbols else [],
        "status": task.status,
        "progress": task.progress,
        "error_message": task.error_message,
        "created_at": task.created_at.isoformat() if task.created_at else None
    }


# ==================== Hyperliquid Backfill ====================

@router.post("/hyperliquid/backfill")
async def start_hyperliquid_backfill(db: Session = Depends(get_db)):
    """Start Hyperliquid K-line backfill task.
    Uses current watchlist symbols.
    Backfills: K-lines (~5000 records, ~3.5 days per symbol).
    """
    from database.models import HyperliquidBackfillTask
    from services.hyperliquid_symbol_service import get_selected_symbols
    from services.exchanges.hyperliquid_backfill import hyperliquid_backfill_service
    import asyncio

    # Check if already running
    running_task = db.query(HyperliquidBackfillTask).filter(
        HyperliquidBackfillTask.status.in_(["pending", "running"])
    ).first()
    if running_task:
        raise HTTPException(status_code=400, detail="A backfill task is already running")

    # Get watchlist symbols
    symbols = get_selected_symbols()
    if not symbols:
        symbols = ["BTC"]

    # Create task
    task = HyperliquidBackfillTask(
        symbols=",".join(symbols),
        status="pending",
        progress=0
    )
    db.add(task)
    db.commit()
    db.refresh(task)

    # Start backfill in background
    asyncio.create_task(hyperliquid_backfill_service.start_backfill(task.id))

    return {
        "task_id": task.id,
        "symbols": symbols,
        "status": "started"
    }


@router.get("/hyperliquid/backfill/status")
def get_hyperliquid_backfill_status(db: Session = Depends(get_db)):
    """Get current Hyperliquid backfill task status."""
    from database.models import HyperliquidBackfillTask

    # Get most recent task
    task = db.query(HyperliquidBackfillTask).order_by(
        HyperliquidBackfillTask.created_at.desc()
    ).first()

    if not task:
        return {"status": "none", "progress": 0}

    return {
        "task_id": task.id,
        "symbols": task.symbols.split(",") if task.symbols else [],
        "status": task.status,
        "progress": task.progress,
        "error_message": task.error_message,
        "created_at": task.created_at.isoformat() if task.created_at else None
    }
