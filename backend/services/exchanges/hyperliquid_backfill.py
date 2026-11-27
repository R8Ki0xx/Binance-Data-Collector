"""
Hyperliquid K-line data backfill service
"""

import asyncio
import logging
from typing import Optional

from database.connection import SessionLocal
from database.models import HyperliquidBackfillTask
from services.hyperliquid_market_data import get_kline_data_from_hyperliquid
from services.hyperliquid_symbol_service import get_selected_symbols

logger = logging.getLogger(__name__)

# Hyperliquid API limit: ~5000 records max
# Coverage: 1m=~3.5 days, 15m=~52 days, 1h=~208 days
KLINE_BACKFILL_LIMIT = 5000
KLINE_PERIODS = ['1m', '15m', '1h']  # Multiple periods for better coverage


class HyperliquidBackfillService:
    """Service for backfilling Hyperliquid K-line data"""

    def __init__(self):
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
            task = db.query(HyperliquidBackfillTask).filter(
                HyperliquidBackfillTask.id == task_id
            ).first()

            if not task:
                logger.error(f"Backfill task {task_id} not found")
                return

            task.status = "running"
            task.progress = 0
            db.commit()

            symbols = task.symbols.split(",") if task.symbols else ["BTC"]
            total_steps = len(symbols) * len(KLINE_PERIODS)  # symbols x periods
            current_step = 0

            for symbol in symbols:
                for period in KLINE_PERIODS:
                    try:
                        await self._backfill_klines(symbol, period)
                    except Exception as e:
                        logger.error(f"Kline backfill failed for {symbol}/{period}: {e}")

                    current_step += 1
                    task.progress = int(current_step / total_steps * 100)
                    db.commit()
                    # Wait 5 seconds between requests to avoid API rate limiting
                    await asyncio.sleep(5)

            task.status = "completed"
            task.progress = 100
            db.commit()
            logger.info(f"Backfill task {task_id} completed")

        except Exception as e:
            logger.error(f"Backfill task {task_id} failed: {e}")
            task = db.query(HyperliquidBackfillTask).filter(
                HyperliquidBackfillTask.id == task_id
            ).first()
            if task:
                task.status = "failed"
                task.error_message = str(e)
                db.commit()
        finally:
            db.close()

    async def _backfill_klines(self, symbol: str, period: str):
        """Backfill K-line data for a symbol and period"""
        logger.info(f"Backfilling {symbol}/{period} (limit={KLINE_BACKFILL_LIMIT})")

        # get_kline_data_from_hyperliquid with persist=True auto-saves to DB
        klines = get_kline_data_from_hyperliquid(
            symbol, period, count=KLINE_BACKFILL_LIMIT, persist=True
        )

        if klines:
            logger.info(f"Klines backfill {symbol}/{period}: got {len(klines)} records")
        else:
            logger.warning(f"No klines data for {symbol}/{period}")


# Singleton instance
hyperliquid_backfill_service = HyperliquidBackfillService()
