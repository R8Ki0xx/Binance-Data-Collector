"""
Binance Data Collector Service (REST API)

Collects market data from Binance using REST API polling:
- K-lines (price data)
- Asset metrics: Open Interest, Funding Rate and Mark Price, stored together
  in one row per minute (indicators need them on the same row)
- Sentiment (long/short ratio)
- Orderbook snapshots

After downtime, K-lines and sentiment are caught up from the last stored record
(one request per series, so older gaps need the manual backfill service).

Note: Taker Buy/Sell volumes are collected via WebSocket (binance_ws_collector.py)
at 15-second granularity. The 1m K-lines collected here only fill minutes for which
the WebSocket collector stored nothing.
"""

import logging
import threading
import time
from datetime import datetime, timezone
from typing import Callable, Dict, List, Optional, Tuple

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
from sqlalchemy import func

from services.exchanges.binance_adapter import BinanceAdapter, BinanceRateLimitError
from services.exchanges.data_persistence import ExchangeDataPersistence
from database.connection import SessionLocal
from database.models import CryptoKline, MarketSentimentMetrics

logger = logging.getLogger(__name__)

# Default collection intervals (seconds)
KLINE_INTERVAL_SECONDS = 60  # 1 minute
SENTIMENT_INTERVAL_SECONDS = 300  # 5 minutes
ORDERBOOK_INTERVAL_SECONDS = 15  # 15 seconds

# Asset metrics run once per minute at this second, so each run lands in its own minute
ASSET_METRICS_CRON_SECOND = 5

# K-line periods to collect (matching Hyperliquid for consistency)
KLINE_PERIOD_SECONDS = {
    '1m': 60,
    '3m': 180,
    '5m': 300,
    '15m': 900,
    '30m': 1800,
    '1h': 3600,
}
KLINE_PERIODS = list(KLINE_PERIOD_SECONDS)

# Candles / records requested per run: the minimum normally, more to close a gap
KLINE_MIN_LIMIT = 5
KLINE_MAX_LIMIT = 1500  # Binance max per request
SENTIMENT_PERIOD_SECONDS = 300
SENTIMENT_MIN_LIMIT = 3
SENTIMENT_MAX_LIMIT = 500  # Binance max per request

REQUEST_MAX_RETRIES = 2
MISFIRE_GRACE_SECONDS = 30


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class BinanceCollector:
    """
    Singleton service for collecting Binance market data via REST API.
    Uses APScheduler for periodic data fetching.
    """

    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._initialized = True

        self.adapter = BinanceAdapter(max_retries=REQUEST_MAX_RETRIES)
        self.scheduler: Optional[BackgroundScheduler] = None
        self.running = False
        self.symbols: List[str] = []
        # Newest stored timestamp (seconds) per series, used to size catch-up requests
        self._watermarks: Dict[Tuple[str, ...], int] = {}
        self._job_status: Dict[str, dict] = {}
        self._status_lock = threading.Lock()

        logger.info("BinanceCollector initialized")

    def start(self, symbols: Optional[List[str]] = None):
        """Start the collector with given symbols"""
        if self.running:
            logger.warning("BinanceCollector already running")
            return

        if symbols is None:
            # Use Binance watchlist, fallback to BTC only
            from services.binance_symbol_service import get_selected_symbols
            symbols = get_selected_symbols() or ["BTC"]
            logger.info(f"[Binance] Using Binance watchlist symbols: {symbols}")

        self.symbols = list(symbols)
        self.scheduler = BackgroundScheduler()

        # Add collection jobs. Each one also runs immediately, on the scheduler's
        # threads, so a slow or unreachable API never blocks application startup.
        self._add_job(
            "binance_klines",
            self._collect_klines,
            IntervalTrigger(seconds=KLINE_INTERVAL_SECONDS),
        )
        self._add_job(
            "binance_asset_metrics",
            self._collect_asset_metrics,
            CronTrigger(second=ASSET_METRICS_CRON_SECOND),
        )
        self._add_job(
            "binance_sentiment",
            self._collect_sentiment,
            IntervalTrigger(seconds=SENTIMENT_INTERVAL_SECONDS),
        )
        self._add_job(
            "binance_orderbook",
            self._collect_orderbook,
            IntervalTrigger(seconds=ORDERBOOK_INTERVAL_SECONDS),
        )

        self.scheduler.start()
        self.running = True
        logger.info(f"BinanceCollector started with symbols: {symbols}")

    def stop(self):
        """Stop the collector"""
        if not self.running:
            return

        if self.scheduler:
            self.scheduler.shutdown(wait=False)
            self.scheduler = None

        self.running = False
        logger.info("BinanceCollector stopped")

    def refresh_symbols(self, new_symbols: List[str]):
        """Update the list of symbols to collect"""
        self.symbols = list(new_symbols)
        logger.info(f"BinanceCollector symbols updated: {new_symbols}")

    def get_status(self) -> dict:
        """Return collection health for each job."""
        with self._status_lock:
            jobs = {name: dict(status) for name, status in self._job_status.items()}
        return {
            "running": self.running,
            "symbols": list(self.symbols),
            "rate_limited_for_seconds": round(self.adapter.rate_limited_for()),
            "jobs": jobs,
        }

    def _add_job(self, job_id: str, func_to_run: Callable, trigger):
        self.scheduler.add_job(
            func=func_to_run,
            trigger=trigger,
            id=job_id,
            replace_existing=True,
            max_instances=1,
            coalesce=True,
            misfire_grace_time=MISFIRE_GRACE_SECONDS,
            next_run_time=datetime.now(timezone.utc),
        )
        logger.info(f"Added job {job_id}: {trigger}")

    # ==================== Job execution ====================

    def _run_job(self, job_name: str, items: List[tuple], collect_one: Callable):
        """
        Run collect_one(persistence, *item) for every item.

        A failing item is rolled back and recorded without affecting the others.
        A rate-limit error ends the run, since every later request would fail too.
        """
        failed: List[str] = []
        last_error: Optional[str] = None

        db = SessionLocal()
        try:
            persistence = ExchangeDataPersistence(db)
            for index, item in enumerate(items):
                label = "/".join(item)
                try:
                    collect_one(persistence, *item)
                except BinanceRateLimitError as e:
                    db.rollback()
                    failed.extend("/".join(rest) for rest in items[index:])
                    last_error = str(e)
                    logger.warning(f"[Binance] {job_name} run stopped: {e}")
                    break
                except Exception as e:
                    db.rollback()
                    failed.append(label)
                    last_error = f"{label}: {e}"
                    logger.error(f"Failed to collect {job_name} for {label}: {e}")
        finally:
            db.close()

        self._record_run(job_name, failed, last_error)

    def _record_run(self, job_name: str, failed: List[str], last_error: Optional[str]):
        now = _utc_now_iso()
        with self._status_lock:
            status = self._job_status.setdefault(job_name, {
                "last_run_at": None,
                "last_success_at": None,
                "consecutive_failures": 0,
                "last_failed_items": [],
                "last_error": None,
            })
            status["last_run_at"] = now
            status["last_failed_items"] = failed
            if failed:
                status["consecutive_failures"] += 1
                status["last_error"] = last_error
            else:
                status["consecutive_failures"] = 0
                status["last_success_at"] = now
                status["last_error"] = None

    def _catch_up_limit(
        self,
        key: Tuple[str, ...],
        load_last_timestamp: Callable[[], Optional[int]],
        period_seconds: int,
        min_limit: int,
        max_limit: int,
    ) -> int:
        """
        Number of records to request so that nothing since the last save is missed.

        Args:
            key: Series identifier for the in-memory watermark
            load_last_timestamp: Reads the newest stored timestamp (seconds)
        """
        last = self._watermarks.get(key)
        if last is None:
            last = load_last_timestamp()
            if last is None:
                return min_limit  # New series: history is the backfill service's job
            # Keep the starting point even if this request fails
            self._watermarks[key] = last

        # +2 re-reads the last stored record, which may have still been open
        wanted = max(0, int(time.time()) - last) // period_seconds + 2
        if wanted > max_limit:
            logger.warning(
                f"[Binance] Gap for {'/'.join(key)} needs {wanted} records, only the "
                f"latest {max_limit} will be fetched; run a backfill for older data"
            )
        return min(max(wanted, min_limit), max_limit)

    # ==================== Collection jobs ====================

    def _collect_klines(self):
        """Collect K-line data for all symbols and periods"""
        items = [(symbol, period) for symbol in self.symbols for period in KLINE_PERIODS]
        self._run_job("klines", items, self._collect_symbol_klines)

    def _collect_symbol_klines(
        self, persistence: ExchangeDataPersistence, symbol: str, period: str
    ):
        key = ("klines", symbol, period)

        def load_last_timestamp():
            return persistence.db.query(func.max(CryptoKline.timestamp)).filter(
                CryptoKline.exchange == "binance",
                CryptoKline.symbol == symbol,
                CryptoKline.market == "CRYPTO",
                CryptoKline.period == period,
                CryptoKline.environment == "mainnet",
            ).scalar()

        limit = self._catch_up_limit(
            key,
            load_last_timestamp,
            KLINE_PERIOD_SECONDS[period],
            KLINE_MIN_LIMIT,
            KLINE_MAX_LIMIT,
        )
        klines = self.adapter.fetch_klines(symbol, period, limit=limit)
        if not klines:
            return

        result = persistence.save_klines(klines)
        if period == '1m':
            persistence.fill_missing_taker_volumes_from_klines(klines)
        self._watermarks[key] = max(k.timestamp for k in klines)
        logger.debug(f"Klines {symbol}/{period}: {result}")

    def _collect_asset_metrics(self):
        """Collect Open Interest, Funding Rate and Mark Price for all symbols"""
        items = [(symbol,) for symbol in self.symbols]
        self._run_job("asset_metrics", items, self._collect_symbol_asset_metrics)

    def _collect_symbol_asset_metrics(
        self, persistence: ExchangeDataPersistence, symbol: str
    ):
        oi = None
        premium = None
        errors = []

        # Fetch independently so one failing endpoint still leaves the other's data
        try:
            oi = self.adapter.fetch_open_interest(symbol)
        except BinanceRateLimitError:
            raise
        except Exception as e:
            errors.append(f"open interest: {e}")

        try:
            # premiumIndex gives the real-time funding rate and mark price
            premium = self.adapter.fetch_premium_index(symbol)
        except BinanceRateLimitError:
            raise
        except Exception as e:
            errors.append(f"premium index: {e}")

        if oi or premium:
            source_ms = premium["timestamp"] if premium else oi.timestamp
            saved = persistence.save_asset_metrics(
                symbol=symbol,
                exchange="binance",
                timestamp_ms=source_ms // 60_000 * 60_000,
                open_interest=oi.open_interest if oi else None,
                funding_rate=premium["funding_rate"] if premium else None,
                mark_price=premium["mark_price"] if premium else None,
            )
            if not saved:
                errors.append("database write failed")

        if errors:
            raise RuntimeError("; ".join(errors))

    def _collect_sentiment(self):
        """Collect Sentiment (long/short ratio) data for all symbols"""
        items = [(symbol,) for symbol in self.symbols]
        self._run_job("sentiment", items, self._collect_symbol_sentiment)

    def _collect_symbol_sentiment(
        self, persistence: ExchangeDataPersistence, symbol: str
    ):
        key = ("sentiment", symbol)

        def load_last_timestamp():
            last_ms = persistence.db.query(
                func.max(MarketSentimentMetrics.timestamp)
            ).filter(
                MarketSentimentMetrics.exchange == "binance",
                MarketSentimentMetrics.symbol == symbol,
                MarketSentimentMetrics.data_type == "top_position",
            ).scalar()
            return None if last_ms is None else last_ms // 1000

        limit = self._catch_up_limit(
            key,
            load_last_timestamp,
            SENTIMENT_PERIOD_SECONDS,
            SENTIMENT_MIN_LIMIT,
            SENTIMENT_MAX_LIMIT,
        )
        sentiment_list = self.adapter.fetch_sentiment_history(symbol, "5m", limit=limit)
        if not sentiment_list:
            return

        result = persistence.save_sentiment_batch(sentiment_list)
        self._watermarks[key] = max(s.timestamp for s in sentiment_list) // 1000
        logger.debug(f"Sentiment {symbol}: {result}")

    def _collect_orderbook(self):
        """Collect Orderbook snapshots for all symbols"""
        items = [(symbol,) for symbol in self.symbols]
        self._run_job("orderbook", items, self._collect_symbol_orderbook)

    def _collect_symbol_orderbook(
        self, persistence: ExchangeDataPersistence, symbol: str
    ):
        orderbook = self.adapter.fetch_orderbook(symbol, depth=10)
        if not persistence.save_orderbook(orderbook):
            raise RuntimeError("database write failed")


# Singleton instance
binance_collector = BinanceCollector()
