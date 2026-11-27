"""
Binance Data Collector Service (REST API)

Collects market data from Binance using REST API polling:
- K-lines (price data + taker volumes as 1-minute backup)
- Open Interest history
- Funding Rate history
- Sentiment (long/short ratio)
- Orderbook snapshots

Note: Taker Buy/Sell volumes are also collected via WebSocket (binance_ws_collector.py)
for 15-second granularity. REST provides 1-minute backup data and historical coverage.
Both write to the same table with automatic deduplication.
"""

import logging
import threading
from typing import List, Optional
from datetime import datetime

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger

from services.exchanges.binance_adapter import BinanceAdapter
from services.exchanges.data_persistence import ExchangeDataPersistence
from database.connection import SessionLocal

logger = logging.getLogger(__name__)

# Default collection intervals (seconds)
KLINE_INTERVAL_SECONDS = 60  # 1 minute
OI_INTERVAL_SECONDS = 60  # 1 minute (using real-time API for finer granularity)

# K-line periods to collect (matching Hyperliquid for consistency)
KLINE_PERIODS = ['1m', '3m', '5m', '15m', '30m', '1h']
FUNDING_INTERVAL_SECONDS = 60  # 1 minute (using premiumIndex for real-time rate)
SENTIMENT_INTERVAL_SECONDS = 300  # 5 minutes
ORDERBOOK_INTERVAL_SECONDS = 15  # 15 seconds


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

        self.adapter = BinanceAdapter()
        self.scheduler: Optional[BackgroundScheduler] = None
        self.running = False
        self.symbols: List[str] = []

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

        self.symbols = symbols
        self.scheduler = BackgroundScheduler()

        # Add collection jobs
        self._add_kline_job()
        self._add_oi_job()
        self._add_funding_job()
        self._add_sentiment_job()
        self._add_orderbook_job()

        self.scheduler.start()
        self.running = True
        logger.info(f"BinanceCollector started with symbols: {symbols}")

        # Run initial collection
        self._collect_all_initial()

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
        self.symbols = new_symbols
        logger.info(f"BinanceCollector symbols updated: {new_symbols}")

    def _add_kline_job(self):
        """Add K-line collection job"""
        self.scheduler.add_job(
            func=self._collect_klines,
            trigger=IntervalTrigger(seconds=KLINE_INTERVAL_SECONDS),
            id="binance_klines",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )
        logger.info(f"Added kline job: every {KLINE_INTERVAL_SECONDS}s")

    def _add_oi_job(self):
        """Add Open Interest collection job"""
        self.scheduler.add_job(
            func=self._collect_oi,
            trigger=IntervalTrigger(seconds=OI_INTERVAL_SECONDS),
            id="binance_oi",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )
        logger.info(f"Added OI job: every {OI_INTERVAL_SECONDS}s")

    def _add_funding_job(self):
        """Add Funding Rate collection job"""
        self.scheduler.add_job(
            func=self._collect_funding,
            trigger=IntervalTrigger(seconds=FUNDING_INTERVAL_SECONDS),
            id="binance_funding",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )
        logger.info(f"Added funding job: every {FUNDING_INTERVAL_SECONDS}s")

    def _add_sentiment_job(self):
        """Add Sentiment (long/short ratio) collection job"""
        self.scheduler.add_job(
            func=self._collect_sentiment,
            trigger=IntervalTrigger(seconds=SENTIMENT_INTERVAL_SECONDS),
            id="binance_sentiment",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )
        logger.info(f"Added sentiment job: every {SENTIMENT_INTERVAL_SECONDS}s")

    def _add_orderbook_job(self):
        """Add Orderbook snapshot collection job"""
        self.scheduler.add_job(
            func=self._collect_orderbook,
            trigger=IntervalTrigger(seconds=ORDERBOOK_INTERVAL_SECONDS),
            id="binance_orderbook",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )
        logger.info(f"Added orderbook job: every {ORDERBOOK_INTERVAL_SECONDS}s")

    def _collect_all_initial(self):
        """Run initial collection for all data types"""
        logger.info("Running initial data collection...")
        self._collect_klines()
        self._collect_oi()
        self._collect_funding()
        self._collect_sentiment()
        self._collect_orderbook()
        logger.info("Initial data collection completed")

    def _collect_klines(self):
        """Collect K-line data for all symbols and periods"""
        db = SessionLocal()
        try:
            persistence = ExchangeDataPersistence(db)
            for symbol in self.symbols:
                for period in KLINE_PERIODS:
                    try:
                        klines = self.adapter.fetch_klines(symbol, period, limit=5)
                        if klines:
                            result = persistence.save_klines(klines)
                            logger.debug(f"Klines {symbol}/{period}: {result}")
                    except Exception as e:
                        logger.error(f"Failed to collect klines for {symbol}/{period}: {e}")
        finally:
            db.close()

    def _collect_oi(self):
        """Collect Open Interest data for all symbols using real-time API"""
        db = SessionLocal()
        try:
            persistence = ExchangeDataPersistence(db)
            for symbol in self.symbols:
                try:
                    # Use real-time API for 1-minute granularity
                    oi = self.adapter.fetch_open_interest(symbol)
                    if oi:
                        result = persistence.save_open_interest(oi)
                        logger.debug(f"OI {symbol}: {result}")
                except Exception as e:
                    logger.error(f"Failed to collect OI for {symbol}: {e}")
        finally:
            db.close()

    def _collect_funding(self):
        """Collect real-time Funding Rate data for all symbols using premiumIndex API"""
        db = SessionLocal()
        try:
            persistence = ExchangeDataPersistence(db)
            for symbol in self.symbols:
                try:
                    # Use premiumIndex for real-time funding rate
                    premium_data = self.adapter.fetch_premium_index(symbol)
                    if premium_data:
                        # Create UnifiedFunding from premium index data
                        from services.exchanges.base_adapter import UnifiedFunding
                        funding = UnifiedFunding(
                            exchange="binance",
                            symbol=symbol,
                            timestamp=premium_data["timestamp"],
                            funding_rate=premium_data["funding_rate"],
                            mark_price=premium_data["mark_price"],
                        )
                        result = persistence.save_funding_rate(funding)
                        logger.debug(f"Funding {symbol}: {result}")
                except Exception as e:
                    logger.error(f"Failed to collect funding for {symbol}: {e}")
        finally:
            db.close()

    def _collect_sentiment(self):
        """Collect Sentiment (long/short ratio) data for all symbols"""
        db = SessionLocal()
        try:
            persistence = ExchangeDataPersistence(db)
            for symbol in self.symbols:
                try:
                    sentiment_list = self.adapter.fetch_sentiment_history(
                        symbol, "5m", limit=3
                    )
                    if sentiment_list:
                        result = persistence.save_sentiment_batch(sentiment_list)
                        logger.debug(f"Sentiment {symbol}: {result}")
                except Exception as e:
                    logger.error(f"Failed to collect sentiment for {symbol}: {e}")
        finally:
            db.close()

    def _collect_orderbook(self):
        """Collect Orderbook snapshots for all symbols"""
        db = SessionLocal()
        try:
            persistence = ExchangeDataPersistence(db)
            for symbol in self.symbols:
                try:
                    orderbook = self.adapter.fetch_orderbook(symbol, depth=10)
                    if orderbook:
                        result = persistence.save_orderbook(orderbook)
                        logger.debug(f"Orderbook {symbol}: {result}")
                except Exception as e:
                    logger.error(f"Failed to collect orderbook for {symbol}: {e}")
        finally:
            db.close()


# Singleton instance
binance_collector = BinanceCollector()
