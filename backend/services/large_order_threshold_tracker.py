"""
Large order threshold tracker for market flow collectors.

Design goals:
- Keep thresholds in memory only. They are runtime statistics, not durable config.
- Warm start from recent aggregated DB data so a restart does not classify the
  first hour of trades with obviously wrong thresholds.
- Use lightweight per-trade updates during runtime. We intentionally avoid
  storing full trade histories or recalculating exact percentiles on each trade.

Important:
- The warm-start threshold is only an approximation because the database stores
  15-second aggregates, not raw trades. We seed from average trade size per
  bucket side, then let live per-trade updates refine the threshold.
- Thresholds are scoped per exchange collector instance. Hyperliquid BTC and
  Binance BTC must never share the same threshold.
"""

import logging
import threading
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Dict, Iterable, List

from database.connection import SessionLocal
from database.models import MarketTradesAggregated

logger = logging.getLogger(__name__)


DEFAULT_THRESHOLDS = {
    "BTC": 50_000.0,
    "ETH": 20_000.0,
    "SOL": 10_000.0,
    "BNB": 10_000.0,
    "XRP": 7_500.0,
    "_default": 10_000.0,
}


class LargeOrderThresholdTracker:
    """
    Tracks an approximate P90 large-order threshold for one exchange.

    Runtime updates use a stochastic quantile-style adjustment:
    - if a trade exceeds the current threshold, push threshold upward
    - otherwise, nudge it downward slightly

    This keeps CPU cost effectively O(1) per trade while converging toward a
    stable high-quantile threshold during normal collector operation.
    """

    def __init__(
        self,
        exchange: str,
        target_quantile: float = 0.9,
        learning_rate: float = 0.001,
        min_step: float = 25.0,
        lookback_hours: int = 24,
    ):
        self.exchange = exchange.lower()
        self.target_quantile = target_quantile
        self.learning_rate = learning_rate
        self.min_step = min_step
        self.lookback_hours = lookback_hours
        self._thresholds: Dict[str, float] = {}
        self._lock = threading.Lock()

    def ensure_symbols(self, symbols: Iterable[str]) -> None:
        """Populate defaults for any symbols not yet tracked."""
        with self._lock:
            for symbol in symbols:
                symbol_upper = symbol.upper()
                if symbol_upper not in self._thresholds:
                    self._thresholds[symbol_upper] = self._default_threshold(symbol_upper)

    def initialize_from_history(self, symbols: List[str]) -> None:
        """
        Seed thresholds from recent aggregated trade history.

        We use average trade size per 15-second side bucket as a warm-start
        estimate only. Exact single-trade P90 is impossible to reconstruct from
        aggregated rows, so live per-trade updates remain the source of truth.
        """
        if not symbols:
            return

        symbols_upper = sorted({symbol.upper() for symbol in symbols})
        cutoff_ms = int((datetime.utcnow() - timedelta(hours=self.lookback_hours)).timestamp() * 1000)

        db = SessionLocal()
        try:
            rows = (
                db.query(
                    MarketTradesAggregated.symbol,
                    MarketTradesAggregated.taker_buy_notional,
                    MarketTradesAggregated.taker_buy_count,
                    MarketTradesAggregated.taker_sell_notional,
                    MarketTradesAggregated.taker_sell_count,
                )
                .filter(
                    MarketTradesAggregated.exchange == self.exchange,
                    MarketTradesAggregated.symbol.in_(symbols_upper),
                    MarketTradesAggregated.timestamp >= cutoff_ms,
                )
                .all()
            )
        finally:
            db.close()

        samples_by_symbol: Dict[str, List[float]] = defaultdict(list)
        for symbol, buy_notional, buy_count, sell_notional, sell_count in rows:
            if buy_count and buy_notional:
                samples_by_symbol[symbol].append(float(buy_notional) / float(buy_count))
            if sell_count and sell_notional:
                samples_by_symbol[symbol].append(float(sell_notional) / float(sell_count))

        with self._lock:
            for symbol in symbols_upper:
                samples = samples_by_symbol.get(symbol, [])
                if samples:
                    self._thresholds[symbol] = self._quantile(samples, self.target_quantile)
                else:
                    self._thresholds[symbol] = self._default_threshold(symbol)

        logger.info(
            "[LargeOrderThresholdTracker] Initialized %s thresholds from %d aggregated rows for %s",
            len(symbols_upper),
            len(rows),
            self.exchange,
        )

    def get_threshold(self, symbol: str) -> float:
        symbol_upper = symbol.upper()
        with self._lock:
            threshold = self._thresholds.get(symbol_upper)
            if threshold is None:
                threshold = self._default_threshold(symbol_upper)
                self._thresholds[symbol_upper] = threshold
            return threshold

    def is_large_order(self, symbol: str, notional: float) -> bool:
        """Classify against the current threshold before ingesting the trade."""
        return notional >= self.get_threshold(symbol)

    def update(self, symbol: str, notional: float) -> None:
        """
        Update threshold with O(1) work per trade.

        This is intentionally approximate. We prefer stable low CPU overhead
        over exact percentile maintenance because collectors run on every trade.
        """
        symbol_upper = symbol.upper()
        with self._lock:
            current = self._thresholds.get(symbol_upper, self._default_threshold(symbol_upper))
            step = max(self.min_step, current * self.learning_rate)

            if notional > current:
                current += step * self.target_quantile
            else:
                current -= step * (1.0 - self.target_quantile)

            floor_value = max(self.min_step, self._default_threshold(symbol_upper) * 0.25)
            self._thresholds[symbol_upper] = max(floor_value, current)

    def _default_threshold(self, symbol: str) -> float:
        return DEFAULT_THRESHOLDS.get(symbol.upper(), DEFAULT_THRESHOLDS["_default"])

    @staticmethod
    def _quantile(values: List[float], q: float) -> float:
        if not values:
            return DEFAULT_THRESHOLDS["_default"]
        ordered = sorted(values)
        index = int((len(ordered) - 1) * q)
        return ordered[index]
