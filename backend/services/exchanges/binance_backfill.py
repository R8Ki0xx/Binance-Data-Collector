# Modified by QuantPilot contributors (2026). See NOTICE.
"""
Binance historical data backfill service
"""

import asyncio
import logging
import time
from dataclasses import replace
from typing import Optional

import requests

from database.connection import SessionLocal
from database.models import BinanceBackfillTask
from .binance_adapter import BinanceAdapter, BinanceRateLimitError
from .data_persistence import ExchangeDataPersistence

logger = logging.getLogger(__name__)

# Backfill limits
KLINE_BACKFILL_LIMIT = 1500  # Per period
KLINE_PERIODS = ['1m', '15m', '1h']  # Multiple periods for better coverage
OI_BACKFILL_DAYS = 30
FUNDING_BACKFILL_DAYS = 365
SENTIMENT_BACKFILL_DAYS = 30

REQUEST_MAX_RETRIES = 2
RATE_LIMIT_MAX_WAITS = 3  # Rate-limit pauses to sit out before giving up on a request


class BinanceBackfillService:
    """Service for backfilling Binance historical data"""

    def __init__(self):
        self.adapter = BinanceAdapter(max_retries=REQUEST_MAX_RETRIES)
        self.running = False
        self.current_task_id: Optional[int] = None

    async def start_backfill(self, task_id: int):
        """Start backfill task"""
        if self.running:
            logger.warning("Backfill already running")
            return False

        self.running = True
        self.current_task_id = task_id

        try:
            await self._process_task(task_id)
        finally:
            self.running = False
            self.current_task_id = None

        return True

    async def _process_task(self, task_id: int):
        """Process a backfill task"""
        db = SessionLocal()
        try:
            task = db.query(BinanceBackfillTask).filter(
                BinanceBackfillTask.id == task_id
            ).first()

            if not task:
                logger.error(f"Backfill task {task_id} not found")
                return

            task.status = "running"
            task.progress = 0
            db.commit()

            symbols = task.symbols.split(",") if task.symbols else ["BTC"]
            # Steps: (klines x periods) + OI + Funding + Sentiment per symbol
            total_steps = len(symbols) * (len(KLINE_PERIODS) + 3)
            current_step = 0
            failed_steps = []

            persistence = ExchangeDataPersistence(db)

            for symbol in symbols:
                # 1. K-lines per period, 2. OI, 3. Funding (365 days), 4. Sentiment (30 days)
                steps = [
                    (f"klines {period}", self._backfill_klines, (symbol, period))
                    for period in KLINE_PERIODS
                ]
                steps += [
                    ("open interest", self._backfill_oi, (symbol,)),
                    ("funding", self._backfill_funding, (symbol,)),
                    ("sentiment", self._backfill_sentiment, (symbol,)),
                ]

                for name, step, args in steps:
                    try:
                        await step(*args, persistence)
                    except Exception as e:
                        db.rollback()
                        logger.error(f"Backfill of {name} failed for {symbol}: {e}")
                        failed_steps.append(f"{symbol} {name}: {e}")
                    current_step += 1
                    task.progress = int(current_step / total_steps * 100)
                    db.commit()
                    # Wait 3 seconds between requests to avoid API rate limiting
                    await asyncio.sleep(3)

            # The OI step only logs that it is skipped, so it can never count as success
            attempted_steps = total_steps - len(symbols)
            task.status = "failed" if len(failed_steps) >= attempted_steps else "completed"
            task.progress = 100
            task.error_message = "\n".join(failed_steps) or None
            db.commit()
            logger.info(
                f"Backfill task {task_id} {task.status} with {len(failed_steps)} failed steps"
            )

        except Exception as e:
            logger.error(f"Backfill task {task_id} failed: {e}")
            db.rollback()
            task = db.query(BinanceBackfillTask).filter(
                BinanceBackfillTask.id == task_id
            ).first()
            if task:
                task.status = "failed"
                task.error_message = str(e)
                db.commit()
        finally:
            db.close()

    async def _fetch(self, fetch_func, *args, **kwargs):
        """
        Call an adapter method off the event loop, waiting out rate-limit pauses.
        """
        for _ in range(RATE_LIMIT_MAX_WAITS):
            try:
                return await asyncio.to_thread(fetch_func, *args, **kwargs)
            except BinanceRateLimitError:
                pause = self.adapter.rate_limited_for() + 1
                logger.warning(f"Backfill rate limited, waiting {pause:.0f}s")
                await asyncio.sleep(pause)
        return await asyncio.to_thread(fetch_func, *args, **kwargs)

    async def _backfill_klines(self, symbol: str, period: str, persistence: ExchangeDataPersistence):
        """Backfill K-line data for a period"""
        logger.info(f"Backfilling klines for {symbol}/{period}")
        klines = await self._fetch(
            self.adapter.fetch_klines, symbol, period, limit=KLINE_BACKFILL_LIMIT
        )
        if klines:
            result = await asyncio.to_thread(persistence.save_klines, klines)
            if period == '1m':
                # Only fills minutes without trade data; WebSocket rows are kept
                await asyncio.to_thread(
                    persistence.fill_missing_taker_volumes_from_klines, klines
                )
            logger.info(f"Klines backfill {symbol}/{period}: {result}")

    async def _backfill_oi(self, symbol: str, persistence: ExchangeDataPersistence):
        """
        Backfill Open Interest history - DISABLED

        Binance OI history API only supports 5m granularity, but real-time collection
        now uses 1m granularity. Mixing 5m historical data with 1m real-time data
        would cause timestamp misalignment and data pollution.

        OI data will be accumulated from real-time collection going forward.
        """
        logger.info(f"OI backfill SKIPPED for {symbol} - using 1m real-time collection instead of 5m history")

    async def _backfill_funding(self, symbol: str, persistence: ExchangeDataPersistence):
        """Backfill Funding Rate history (365 days)"""
        logger.info(f"Backfilling funding for {symbol} ({FUNDING_BACKFILL_DAYS} days)")
        total = 0
        end_time = int(time.time() * 1000)
        start_time = end_time - (FUNDING_BACKFILL_DAYS * 24 * 60 * 60 * 1000)

        current_end = end_time
        while current_end > start_time:
            funding_list = await self._fetch(
                self.adapter.fetch_funding_history,
                symbol, limit=1000, end_time=current_end,
            )
            if not funding_list:
                break
            # Align to the minute so settlements share a row with live asset metrics
            aligned = [
                replace(f, timestamp=f.timestamp // 60_000 * 60_000)
                for f in funding_list
            ]
            # Save page by page so a later failure keeps what was already fetched
            await asyncio.to_thread(persistence.save_funding_rate_batch, aligned)
            total += len(aligned)
            current_end = min(f.timestamp for f in funding_list) - 1
            await asyncio.sleep(0.5)

        logger.info(f"Funding backfill {symbol}: {total} records")

    async def _backfill_sentiment(self, symbol: str, persistence: ExchangeDataPersistence):
        """Backfill Long/Short ratio history (30 days)"""
        logger.info(f"Backfilling sentiment for {symbol} ({SENTIMENT_BACKFILL_DAYS} days)")
        total = 0
        end_time = int(time.time() * 1000)
        start_time = end_time - (SENTIMENT_BACKFILL_DAYS * 24 * 60 * 60 * 1000)

        current_end = end_time
        while current_end > start_time:
            try:
                sentiment_list = await self._fetch(
                    self.adapter.fetch_sentiment_history,
                    symbol, "5m", limit=500, end_time=current_end,
                )
            except requests.exceptions.HTTPError as e:
                # Binance rejects ranges older than its retention window
                if total and getattr(e.response, "status_code", None) == 400:
                    break
                raise
            if not sentiment_list:
                break
            await asyncio.to_thread(persistence.save_sentiment_batch, sentiment_list)
            total += len(sentiment_list)
            current_end = min(s.timestamp for s in sentiment_list) - 1
            await asyncio.sleep(0.5)

        logger.info(f"Sentiment backfill {symbol}: {total} records")


# Singleton instance
binance_backfill_service = BinanceBackfillService()