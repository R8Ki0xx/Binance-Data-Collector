"""
Factor Data Provider

Provides K-line data for factor computation by reading from local DB first,
with automatic backfill from exchange APIs when data is insufficient.
"""

import logging
import time
from typing import List, Dict, Optional

from sqlalchemy.orm import Session
from sqlalchemy import text

logger = logging.getLogger(__name__)

MIN_BARS_DEFAULT = 2000


def get_klines_from_db(
    db: Session, exchange: str, symbol: str, period: str = "1h",
    start_ts: Optional[int] = None, end_ts: Optional[int] = None,
) -> List[Dict]:
    """Read klines from local crypto_klines table.

    Args:
        start_ts: optional lower bound (seconds, inclusive)
        end_ts:   optional upper bound (seconds, inclusive)
    """
    sql = ("SELECT timestamp, open_price, high_price, low_price, close_price, volume "
           "FROM crypto_klines "
           "WHERE exchange = :ex AND symbol = :sym AND period = :p")
    params: dict = {"ex": exchange, "sym": symbol, "p": period}
    if start_ts is not None:
        sql += " AND timestamp >= :start"
        params["start"] = start_ts
    if end_ts is not None:
        sql += " AND timestamp <= :end"
        params["end"] = end_ts
    sql += " ORDER BY timestamp ASC"

    rows = db.execute(text(sql), params).fetchall()

    return [
        {
            "timestamp": r[0], "open": float(r[1]), "high": float(r[2]),
            "low": float(r[3]), "close": float(r[4]), "volume": float(r[5]),
        }
        for r in rows
    ]


def ensure_kline_coverage(
    db: Session, exchange: str, symbol: str,
    period: str = "1h", min_bars: int = MIN_BARS_DEFAULT
) -> List[Dict]:
    """
    Get klines from DB with automatic backfill if insufficient.
    Returns the full kline list sorted by timestamp ASC.
    """
    klines = get_klines_from_db(db, exchange, symbol, period)

    if len(klines) >= min_bars:
        return klines

    # Backfill needed
    current_count = len(klines)
    needed = min_bars - current_count
    print(f"[FactorDataProvider] {exchange}/{symbol}/{period}: "
          f"have {current_count}, need {min_bars}, backfilling {needed}",
          flush=True)

    try:
        if exchange == "binance":
            _backfill_binance(db, symbol, period, min_bars)
        else:
            _backfill_hyperliquid(symbol, period, min_bars)
    except Exception as e:
        logger.warning(f"[FactorDataProvider] backfill {exchange}/{symbol}: {e}")

    # Re-read after backfill
    return get_klines_from_db(db, exchange, symbol, period)


def _backfill_hyperliquid(symbol: str, period: str, target_bars: int):
    """Backfill Hyperliquid klines via API. persist=True auto-saves to DB."""
    from services.hyperliquid_market_data import get_kline_data_from_hyperliquid

    # Hyperliquid max ~5000 per request
    count = min(target_bars, 5000)
    klines = get_kline_data_from_hyperliquid(
        symbol, period, count=count, persist=True
    )
    print(f"[FactorDataProvider] Hyperliquid backfill {symbol}/{period}: "
          f"got {len(klines) if klines else 0} bars", flush=True)


def _backfill_binance(db: Session, symbol: str, period: str, target_bars: int):
    """Backfill Binance klines via API with pagination."""
    from services.exchanges.binance_adapter import BinanceAdapter
    from services.exchanges.data_persistence import ExchangeDataPersistence

    adapter = BinanceAdapter()
    persistence = ExchangeDataPersistence(db)

    # Binance max 1500 per request, paginate if needed
    batch_size = 1500
    total_fetched = 0
    end_time = int(time.time() * 1000)

    # Calculate how far back we need to go
    period_seconds = _period_to_seconds(period)
    start_time = end_time - (target_bars * period_seconds * 1000)

    current_end = end_time
    while total_fetched < target_bars and current_end > start_time:
        try:
            klines = adapter.fetch_klines(
                symbol, period, limit=batch_size, end_time=current_end
            )
            if not klines:
                break

            result = persistence.save_klines(klines)
            total_fetched += len(klines)

            # Move end_time back for next batch
            earliest_ts = min(k.timestamp for k in klines)
            current_end = int(earliest_ts * 1000) - 1

            print(f"[FactorDataProvider] Binance backfill {symbol}/{period}: "
                  f"batch {len(klines)}, total {total_fetched}", flush=True)

            # Rate limit
            time.sleep(1)

        except Exception as e:
            logger.warning(f"[FactorDataProvider] Binance batch failed: {e}")
            break

    print(f"[FactorDataProvider] Binance backfill {symbol}/{period}: "
          f"done, total {total_fetched} bars", flush=True)


def _period_to_seconds(period: str) -> int:
    """Convert period string to seconds."""
    mapping = {
        "1m": 60, "5m": 300, "15m": 900,
        "1h": 3600, "4h": 14400, "1d": 86400,
    }
    return mapping.get(period, 3600)
