"""
Signal Analysis Service

Provides statistical analysis of market flow indicators to help users
set appropriate signal thresholds.
"""

import logging
from typing import Dict, Any, Optional, List
from datetime import datetime
from decimal import Decimal

from sqlalchemy.orm import Session
from sqlalchemy import func

logger = logging.getLogger(__name__)

# Minimum samples required (15 minutes of 5m data = 3 samples)
MIN_SAMPLES = 3
# Warning threshold for limited data
LIMITED_DATA_THRESHOLD = 10


class SignalAnalysisService:
    """Service for analyzing market flow indicators and suggesting thresholds."""

    def analyze_metric(
        self,
        db: Session,
        symbol: str,
        metric: str,
        period: str,
        days: int = 7,
        exchange: str = "hyperliquid"
    ) -> Dict[str, Any]:
        """
        Analyze a metric and provide statistical summary with threshold suggestions.

        Args:
            db: Database session
            symbol: Trading symbol (e.g., "BTC")
            metric: Metric type (e.g., "oi_delta_percent", "cvd")
            period: Time period (e.g., "5m", "15m")
            days: Number of days to analyze (default 7)
            exchange: Exchange to analyze (default "hyperliquid")

        Returns:
            Dict with statistics and suggestions, or error info
        """
        try:
            # Map old metric names to new names (backward compatibility)
            metric_name_map = {
                "oi_delta_percent": "oi_delta",
                "funding_rate": "funding",
                "taker_buy_ratio": "taker_ratio",
            }
            metric = metric_name_map.get(metric, metric)

            # Handle taker_volume specially (returns complete result dict)
            if metric == "taker_volume":
                from services.market_flow_indicators import TIMEFRAME_MS
                if period not in TIMEFRAME_MS:
                    raise ValueError(f"Unsupported period: {period}")
                interval_ms = TIMEFRAME_MS[period]
                current_time_ms = int(datetime.utcnow().timestamp() * 1000)
                start_time_ms = current_time_ms - (days * 24 * 60 * 60 * 1000)
                return self._analyze_taker_volume(
                    db, symbol, interval_ms, start_time_ms, current_time_ms, days, exchange
                )

            # Get historical values for the metric
            values, time_range = self._get_metric_history(db, symbol, metric, period, days, exchange)

            if len(values) < MIN_SAMPLES:
                return {
                    "status": "insufficient_data",
                    "message": f"Need at least {MIN_SAMPLES} samples, found {len(values)}",
                    "sample_count": len(values),
                    "required_samples": MIN_SAMPLES
                }

            # Determine precision based on metric type
            precision = 2 if metric == "funding" else 4

            # For funding metric, filter out near-zero values for threshold calculation
            # Funding rate changes are sparse - most periods have no change
            # We want to suggest thresholds based on actual changes, not zeros
            if metric == "funding":
                # Keep original values for range display
                all_values = values
                # Filter for threshold calculation (exclude values close to 0)
                non_zero_values = [v for v in values if abs(v) > 0.01]

                if len(non_zero_values) < MIN_SAMPLES:
                    # Not enough non-zero changes, use all values
                    stats = self._calculate_statistics(values, precision)
                    suggestions = self._generate_suggestions(stats, metric)
                else:
                    # Calculate stats on non-zero values for better thresholds
                    stats = self._calculate_statistics(non_zero_values, precision)
                    suggestions = self._generate_suggestions(stats, metric)
                    # But show full range from all values
                    import numpy as np
                    stats["min"] = round(float(np.min(all_values)), precision)
                    stats["max"] = round(float(np.max(all_values)), precision)

                # Add info about data composition
                zero_pct = (len(values) - len(non_zero_values)) / len(values) * 100
                result = {
                    "status": "ok",
                    "symbol": symbol,
                    "metric": metric,
                    "period": period,
                    "sample_count": len(values),
                    "active_samples": len(non_zero_values),
                    "time_range_hours": time_range,
                    "statistics": stats,
                    "suggestions": suggestions
                }
                if zero_pct > 50:
                    result["info"] = f"Funding rate is stable {zero_pct:.0f}% of the time. Thresholds based on {len(non_zero_values)} active change periods."
                return result

            # Standard processing for other metrics
            stats = self._calculate_statistics(values, precision)

            # Generate threshold suggestions
            suggestions = self._generate_suggestions(stats, metric)

            result = {
                "status": "ok",
                "symbol": symbol,
                "metric": metric,
                "period": period,
                "sample_count": len(values),
                "time_range_hours": time_range,
                "statistics": stats,
                "suggestions": suggestions
            }

            # Add warning if limited data
            if len(values) < LIMITED_DATA_THRESHOLD:
                result["warning"] = f"Limited data ({len(values)} samples). Statistics may not be representative."

            return result

        except Exception as e:
            logger.error(f"Error analyzing metric {metric} for {symbol}: {e}", exc_info=True)
            return {
                "status": "error",
                "message": str(e)
            }

    def _get_metric_history(
        self,
        db: Session,
        symbol: str,
        metric: str,
        period: str,
        days: int,
        exchange: str = "hyperliquid"
    ) -> tuple[List[float], float]:
        """Get historical values for a metric. Returns (values, time_range_hours)."""
        from services.market_flow_indicators import TIMEFRAME_MS, floor_timestamp
        from database.models import MarketAssetMetrics, MarketTradesAggregated, MarketOrderbookSnapshots

        if period not in TIMEFRAME_MS:
            raise ValueError(f"Unsupported period: {period}")

        interval_ms = TIMEFRAME_MS[period]
        current_time_ms = int(datetime.utcnow().timestamp() * 1000)
        start_time_ms = current_time_ms - (days * 24 * 60 * 60 * 1000)

        values = []
        min_ts = None
        max_ts = None

        # Metric names aligned with K-line indicators (MarketFlowIndicators.tsx)
        # cvd, taker_volume, oi, oi_delta, funding, depth_ratio, order_imbalance
        if metric == "oi_delta":
            values, min_ts, max_ts = self._get_oi_delta_history(
                db, symbol, interval_ms, start_time_ms, current_time_ms, exchange
            )
        elif metric == "cvd":
            values, min_ts, max_ts = self._get_cvd_history(
                db, symbol, interval_ms, start_time_ms, current_time_ms, exchange
            )
        elif metric == "depth_ratio":
            values, min_ts, max_ts = self._get_depth_ratio_history(
                db, symbol, interval_ms, start_time_ms, current_time_ms, exchange
            )
        elif metric == "order_imbalance":
            values, min_ts, max_ts = self._get_imbalance_history(
                db, symbol, interval_ms, start_time_ms, current_time_ms, exchange
            )
        elif metric == "taker_ratio":
            # Taker buy/sell ratio (buy/sell), aligned with K-line TAKER indicator
            values, min_ts, max_ts = self._get_taker_ratio_history(
                db, symbol, interval_ms, start_time_ms, current_time_ms, exchange
            )
        elif metric == "funding":
            values, min_ts, max_ts = self._get_funding_history(
                db, symbol, interval_ms, start_time_ms, current_time_ms, exchange
            )
        elif metric == "oi":
            values, min_ts, max_ts = self._get_oi_history(
                db, symbol, interval_ms, start_time_ms, current_time_ms, exchange
            )
        elif metric == "price_change":
            values, min_ts, max_ts = self._get_price_change_history(
                db, symbol, interval_ms, start_time_ms, current_time_ms, exchange
            )
        elif metric == "volatility":
            values, min_ts, max_ts = self._get_volatility_history(
                db, symbol, interval_ms, start_time_ms, current_time_ms, exchange
            )
        else:
            raise ValueError(f"Unsupported metric: {metric}")

        # Calculate time range in hours
        time_range_hours = 0.0
        if min_ts and max_ts:
            time_range_hours = (max_ts - min_ts) / (1000 * 60 * 60)

        return values, time_range_hours

    def _get_oi_delta_history(self, db, symbol, interval_ms, start_time_ms, current_time_ms, exchange="hyperliquid"):
        """Get OI delta percentage history."""
        from services.market_flow_indicators import floor_timestamp
        from database.models import MarketAssetMetrics

        records = db.query(
            MarketAssetMetrics.timestamp,
            MarketAssetMetrics.open_interest
        ).filter(
            MarketAssetMetrics.exchange == exchange,
            MarketAssetMetrics.symbol == symbol.upper(),
            MarketAssetMetrics.timestamp >= start_time_ms,
            MarketAssetMetrics.timestamp <= current_time_ms
        ).order_by(MarketAssetMetrics.timestamp).all()

        if not records:
            return [], None, None

        # Bucket by period
        buckets = {}
        for ts, oi in records:
            bucket_ts = floor_timestamp(ts, interval_ms)
            buckets[bucket_ts] = float(oi) if oi else None

        # Calculate deltas
        sorted_times = sorted(buckets.keys())
        values = []
        for i in range(1, len(sorted_times)):
            prev_oi = buckets[sorted_times[i-1]]
            curr_oi = buckets[sorted_times[i]]
            if prev_oi and curr_oi and prev_oi != 0:
                delta_pct = ((curr_oi - prev_oi) / prev_oi) * 100
                values.append(delta_pct)

        min_ts = sorted_times[0] if sorted_times else None
        max_ts = sorted_times[-1] if sorted_times else None
        return values, min_ts, max_ts

    def _get_cvd_history(self, db, symbol, interval_ms, start_time_ms, current_time_ms, exchange="hyperliquid"):
        """Get CVD history."""
        from services.market_flow_indicators import floor_timestamp
        from database.models import MarketTradesAggregated

        records = db.query(
            MarketTradesAggregated.timestamp,
            MarketTradesAggregated.taker_buy_notional,
            MarketTradesAggregated.taker_sell_notional
        ).filter(
            MarketTradesAggregated.exchange == exchange,
            MarketTradesAggregated.symbol == symbol.upper(),
            MarketTradesAggregated.timestamp >= start_time_ms,
            MarketTradesAggregated.timestamp <= current_time_ms
        ).order_by(MarketTradesAggregated.timestamp).all()

        if not records:
            return [], None, None

        buckets = {}
        for ts, buy, sell in records:
            bucket_ts = floor_timestamp(ts, interval_ms)
            if bucket_ts not in buckets:
                buckets[bucket_ts] = {"buy": 0, "sell": 0}
            buckets[bucket_ts]["buy"] += float(buy or 0)
            buckets[bucket_ts]["sell"] += float(sell or 0)

        sorted_times = sorted(buckets.keys())
        values = [buckets[ts]["buy"] - buckets[ts]["sell"] for ts in sorted_times]

        min_ts = sorted_times[0] if sorted_times else None
        max_ts = sorted_times[-1] if sorted_times else None
        return values, min_ts, max_ts

    def _get_depth_ratio_history(self, db, symbol, interval_ms, start_time_ms, current_time_ms, exchange="hyperliquid"):
        """Get depth ratio (bid/ask) history."""
        from services.market_flow_indicators import floor_timestamp
        from database.models import MarketOrderbookSnapshots

        records = db.query(
            MarketOrderbookSnapshots.timestamp,
            MarketOrderbookSnapshots.bid_depth_5,
            MarketOrderbookSnapshots.ask_depth_5
        ).filter(
            MarketOrderbookSnapshots.exchange == exchange,
            MarketOrderbookSnapshots.symbol == symbol.upper(),
            MarketOrderbookSnapshots.timestamp >= start_time_ms,
            MarketOrderbookSnapshots.timestamp <= current_time_ms
        ).order_by(MarketOrderbookSnapshots.timestamp).all()

        if not records:
            return [], None, None

        buckets = {}
        for ts, bid, ask in records:
            bucket_ts = floor_timestamp(ts, interval_ms)
            buckets[bucket_ts] = {"bid": float(bid or 0), "ask": float(ask or 0)}

        sorted_times = sorted(buckets.keys())
        values = []
        for ts in sorted_times:
            ask = buckets[ts]["ask"]
            if ask > 0:
                values.append(buckets[ts]["bid"] / ask)

        min_ts = sorted_times[0] if sorted_times else None
        max_ts = sorted_times[-1] if sorted_times else None
        return values, min_ts, max_ts

    def _get_imbalance_history(self, db, symbol, interval_ms, start_time_ms, current_time_ms, exchange="hyperliquid"):
        """Get order imbalance history."""
        from services.market_flow_indicators import floor_timestamp
        from database.models import MarketOrderbookSnapshots

        records = db.query(
            MarketOrderbookSnapshots.timestamp,
            MarketOrderbookSnapshots.bid_depth_5,
            MarketOrderbookSnapshots.ask_depth_5
        ).filter(
            MarketOrderbookSnapshots.exchange == exchange,
            MarketOrderbookSnapshots.symbol == symbol.upper(),
            MarketOrderbookSnapshots.timestamp >= start_time_ms,
            MarketOrderbookSnapshots.timestamp <= current_time_ms
        ).order_by(MarketOrderbookSnapshots.timestamp).all()

        if not records:
            return [], None, None

        buckets = {}
        for ts, bid, ask in records:
            bucket_ts = floor_timestamp(ts, interval_ms)
            buckets[bucket_ts] = {"bid": float(bid or 0), "ask": float(ask or 0)}

        sorted_times = sorted(buckets.keys())
        values = []
        for ts in sorted_times:
            bid, ask = buckets[ts]["bid"], buckets[ts]["ask"]
            total = bid + ask
            if total > 0:
                values.append((bid - ask) / total)

        min_ts = sorted_times[0] if sorted_times else None
        max_ts = sorted_times[-1] if sorted_times else None
        return values, min_ts, max_ts

    def _get_taker_ratio_history(self, db, symbol, interval_ms, start_time_ms, current_time_ms, exchange="hyperliquid"):
        """Get taker buy/sell log ratio history. Uses ln(buy/sell) for symmetry around 0.

        Log transformation makes the ratio symmetric:
        - ln(2.0) = +0.69 (buyers 2x sellers)
        - ln(1.0) = 0 (balanced)
        - ln(0.5) = -0.69 (sellers 2x buyers)
        """
        import math
        from services.market_flow_indicators import floor_timestamp
        from database.models import MarketTradesAggregated

        records = db.query(
            MarketTradesAggregated.timestamp,
            MarketTradesAggregated.taker_buy_notional,
            MarketTradesAggregated.taker_sell_notional
        ).filter(
            MarketTradesAggregated.exchange == exchange,
            MarketTradesAggregated.symbol == symbol.upper(),
            MarketTradesAggregated.timestamp >= start_time_ms,
            MarketTradesAggregated.timestamp <= current_time_ms
        ).order_by(MarketTradesAggregated.timestamp).all()

        if not records:
            return [], None, None

        buckets = {}
        for ts, buy, sell in records:
            bucket_ts = floor_timestamp(ts, interval_ms)
            if bucket_ts not in buckets:
                buckets[bucket_ts] = {"buy": 0, "sell": 0}
            buckets[bucket_ts]["buy"] += float(buy or 0)
            buckets[bucket_ts]["sell"] += float(sell or 0)

        sorted_times = sorted(buckets.keys())
        values = []
        for ts in sorted_times:
            buy = buckets[ts]["buy"]
            sell = buckets[ts]["sell"]
            # Log ratio = ln(buy/sell), symmetric around 0
            if buy > 0 and sell > 0:
                values.append(math.log(buy / sell))

        min_ts = sorted_times[0] if sorted_times else None
        max_ts = sorted_times[-1] if sorted_times else None
        return values, min_ts, max_ts

    def _get_funding_history(self, db, symbol, interval_ms, start_time_ms, current_time_ms, exchange="hyperliquid"):
        """Get funding rate change history. Aligned with K-line FUNDING indicator display."""
        from services.market_flow_indicators import floor_timestamp
        from database.models import MarketAssetMetrics

        # Load data for requested range + one extra interval for first change calc
        query_start_ms = start_time_ms - interval_ms

        records = db.query(
            MarketAssetMetrics.timestamp,
            MarketAssetMetrics.funding_rate
        ).filter(
            MarketAssetMetrics.exchange == exchange,
            MarketAssetMetrics.symbol == symbol.upper(),
            MarketAssetMetrics.timestamp >= query_start_ms,
            MarketAssetMetrics.timestamp <= current_time_ms,
            MarketAssetMetrics.funding_rate.isnot(None)
        ).order_by(MarketAssetMetrics.timestamp).all()

        if not records:
            return [], None, None

        buckets = {}
        for ts, funding in records:
            bucket_ts = floor_timestamp(ts, interval_ms)
            buckets[bucket_ts] = float(funding) * 1000000  # Align with K-line display

        sorted_times = sorted(buckets.keys())
        if len(sorted_times) < 2:
            return [], None, None

        # Calculate change values (current - previous) for each period
        change_values = []
        result_times = []
        for i in range(1, len(sorted_times)):
            ts = sorted_times[i]
            if ts >= start_time_ms:  # Only include values in requested range
                change = buckets[ts] - buckets[sorted_times[i - 1]]
                change_values.append(change)
                result_times.append(ts)

        min_ts = result_times[0] if result_times else None
        max_ts = result_times[-1] if result_times else None
        return change_values, min_ts, max_ts

    def _get_oi_history(self, db, symbol, interval_ms, start_time_ms, current_time_ms, exchange="hyperliquid"):
        """Get OI USD change history.

        OI change = (current_OI - previous_OI) × mark_price
        Returns USD value (can be positive or negative).
        """
        from services.market_flow_indicators import floor_timestamp
        from database.models import MarketAssetMetrics

        # Load data for requested range + one extra interval for first change calc
        query_start_ms = start_time_ms - interval_ms

        records = db.query(
            MarketAssetMetrics.timestamp,
            MarketAssetMetrics.open_interest,
            MarketAssetMetrics.mark_price
        ).filter(
            MarketAssetMetrics.exchange == exchange,
            MarketAssetMetrics.symbol == symbol.upper(),
            MarketAssetMetrics.timestamp >= query_start_ms,
            MarketAssetMetrics.timestamp <= current_time_ms,
            MarketAssetMetrics.open_interest.isnot(None),
            MarketAssetMetrics.mark_price.isnot(None)
        ).order_by(MarketAssetMetrics.timestamp).all()

        if not records:
            return [], None, None

        # Build raw buckets with OI and price
        raw_buckets = {}
        for ts, oi, price in records:
            bucket_ts = floor_timestamp(ts, interval_ms)
            raw_buckets[bucket_ts] = (float(oi), float(price))

        sorted_times = sorted(raw_buckets.keys())
        if len(sorted_times) < 2:
            return [], None, None

        # Calculate USD change for each bucket
        change_values = []
        result_times = []
        for i in range(1, len(sorted_times)):
            ts = sorted_times[i]
            if ts < start_time_ms:
                continue

            curr_oi, curr_price = raw_buckets[ts]
            prev_oi, _ = raw_buckets[sorted_times[i-1]]
            change_usd = (curr_oi - prev_oi) * curr_price
            change_values.append(round(change_usd, 2))
            result_times.append(ts)

        min_ts = result_times[0] if result_times else None
        max_ts = result_times[-1] if result_times else None
        return change_values, min_ts, max_ts

    def _get_price_change_history(self, db, symbol, interval_ms, start_time_ms, current_time_ms, exchange="hyperliquid"):
        """Get price change percentage history."""
        from services.market_flow_indicators import floor_timestamp
        from database.models import MarketTradesAggregated

        records = db.query(
            MarketTradesAggregated.timestamp,
            MarketTradesAggregated.high_price
        ).filter(
            MarketTradesAggregated.exchange == exchange,
            MarketTradesAggregated.symbol == symbol.upper(),
            MarketTradesAggregated.timestamp >= start_time_ms,
            MarketTradesAggregated.timestamp <= current_time_ms,
            MarketTradesAggregated.high_price.isnot(None)
        ).order_by(MarketTradesAggregated.timestamp).all()

        if not records:
            return [], None, None

        buckets = {}
        for ts, high_price in records:
            bucket_ts = floor_timestamp(ts, interval_ms)
            if bucket_ts not in buckets:
                buckets[bucket_ts] = {"first": None, "last": None}
            price = float(high_price)
            if buckets[bucket_ts]["first"] is None:
                buckets[bucket_ts]["first"] = price
            buckets[bucket_ts]["last"] = price

        sorted_times = sorted(buckets.keys())
        values = []
        for i in range(1, len(sorted_times)):
            prev_price = buckets[sorted_times[i-1]]["last"]
            curr_price = buckets[sorted_times[i]]["last"]
            if prev_price and prev_price > 0:
                change_pct = ((curr_price - prev_price) / prev_price) * 100
                values.append(change_pct)

        min_ts = sorted_times[0] if sorted_times else None
        max_ts = sorted_times[-1] if sorted_times else None
        return values, min_ts, max_ts

    def _get_volatility_history(self, db, symbol, interval_ms, start_time_ms, current_time_ms, exchange="hyperliquid"):
        """Get price volatility (high-low)/low percentage history."""
        from services.market_flow_indicators import floor_timestamp
        from database.models import MarketTradesAggregated

        records = db.query(
            MarketTradesAggregated.timestamp,
            MarketTradesAggregated.high_price,
            MarketTradesAggregated.low_price
        ).filter(
            MarketTradesAggregated.exchange == exchange,
            MarketTradesAggregated.symbol == symbol.upper(),
            MarketTradesAggregated.timestamp >= start_time_ms,
            MarketTradesAggregated.timestamp <= current_time_ms,
            MarketTradesAggregated.high_price.isnot(None),
            MarketTradesAggregated.low_price.isnot(None)
        ).order_by(MarketTradesAggregated.timestamp).all()

        if not records:
            return [], None, None

        buckets = {}
        for ts, high_price, low_price in records:
            bucket_ts = floor_timestamp(ts, interval_ms)
            if bucket_ts not in buckets:
                buckets[bucket_ts] = {"high": None, "low": None}
            h = float(high_price)
            l = float(low_price)
            if buckets[bucket_ts]["high"] is None or h > buckets[bucket_ts]["high"]:
                buckets[bucket_ts]["high"] = h
            if buckets[bucket_ts]["low"] is None or l < buckets[bucket_ts]["low"]:
                buckets[bucket_ts]["low"] = l

        sorted_times = sorted(buckets.keys())
        values = []
        for ts in sorted_times:
            high = buckets[ts]["high"]
            low = buckets[ts]["low"]
            if high and low and low > 0:
                volatility_pct = ((high - low) / low) * 100
                values.append(volatility_pct)

        min_ts = sorted_times[0] if sorted_times else None
        max_ts = sorted_times[-1] if sorted_times else None
        return values, min_ts, max_ts

    def _calculate_statistics(self, values: List[float], precision: int = 4) -> Dict[str, Any]:
        """Calculate statistical summary of values."""
        import numpy as np

        arr = np.array(values)
        abs_arr = np.abs(arr)
        return {
            "mean": round(float(np.mean(arr)), precision),
            "std": round(float(np.std(arr)), precision),
            "min": round(float(np.min(arr)), precision),
            "max": round(float(np.max(arr)), precision),
            "abs_percentiles": {
                "p75": round(float(np.percentile(abs_arr, 75)), precision),
                "p90": round(float(np.percentile(abs_arr, 90)), precision),
                "p95": round(float(np.percentile(abs_arr, 95)), precision),
                "p99": round(float(np.percentile(abs_arr, 99)), precision)
            }
        }

    def _generate_suggestions(self, stats: Dict[str, Any], metric: str) -> Dict[str, Any]:
        """Generate threshold suggestions based on statistics."""
        import math

        p = stats["abs_percentiles"]

        suggestions = {
            "aggressive": {
                "threshold": p["p75"],
                "description": "~25% trigger rate"
            },
            "moderate": {
                "threshold": p["p90"],
                "description": "~10% trigger rate",
                "recommended": True
            },
            "conservative": {
                "threshold": p["p95"],
                "description": "~5% trigger rate"
            }
        }

        # For taker_ratio (log values), add multiplier info for user understanding
        if metric == "taker_ratio":
            for key in suggestions:
                log_val = suggestions[key]["threshold"]
                multiplier = round(math.exp(abs(log_val)), 2)
                suggestions[key]["multiplier"] = multiplier
                suggestions[key]["description"] += f" ({multiplier}x)"

        # For OI (USD change), format large numbers for readability
        if metric == "oi":
            for key in suggestions:
                val = suggestions[key]["threshold"]
                if abs(val) >= 1_000_000_000:
                    suggestions[key]["description"] += f" (${val/1_000_000_000:.1f}B)"
                elif abs(val) >= 1_000_000:
                    suggestions[key]["description"] += f" (${val/1_000_000:.1f}M)"

        return suggestions

    def _analyze_taker_volume(self, db, symbol, interval_ms, start_time_ms, current_time_ms, days, exchange="hyperliquid"):
        """
        Analyze taker_volume composite signal.
        Returns statistics for both ratio and volume dimensions.
        """
        from services.market_flow_indicators import floor_timestamp
        from database.models import MarketTradesAggregated
        import numpy as np

        records = db.query(
            MarketTradesAggregated.timestamp,
            MarketTradesAggregated.taker_buy_notional,
            MarketTradesAggregated.taker_sell_notional
        ).filter(
            MarketTradesAggregated.exchange == exchange,
            MarketTradesAggregated.symbol == symbol.upper(),
            MarketTradesAggregated.timestamp >= start_time_ms,
            MarketTradesAggregated.timestamp <= current_time_ms
        ).order_by(MarketTradesAggregated.timestamp).all()

        if not records:
            return {"status": "insufficient_data", "message": "No data available"}

        buckets = {}
        for ts, buy, sell in records:
            bucket_ts = floor_timestamp(ts, interval_ms)
            if bucket_ts not in buckets:
                buckets[bucket_ts] = {"buy": 0, "sell": 0}
            buckets[bucket_ts]["buy"] += float(buy or 0)
            buckets[bucket_ts]["sell"] += float(sell or 0)

        sorted_times = sorted(buckets.keys())
        if len(sorted_times) < MIN_SAMPLES:
            return {
                "status": "insufficient_data",
                "message": f"Need at least {MIN_SAMPLES} samples, found {len(sorted_times)}"
            }

        # Calculate log ratio and volume for each period
        # Log ratio = ln(buy/sell), symmetric around 0
        # >0 means buyers dominate, <0 means sellers dominate
        import math
        ratios = []
        volumes = []
        for ts in sorted_times:
            buy = buckets[ts]["buy"]
            sell = buckets[ts]["sell"]
            total = buy + sell
            if total > 0 and buy > 0 and sell > 0:
                ratio = math.log(buy / sell)  # Log transformation for symmetry
                ratios.append(ratio)
                volumes.append(total)

        if len(ratios) < MIN_SAMPLES:
            return {
                "status": "insufficient_data",
                "message": f"Need at least {MIN_SAMPLES} valid samples"
            }

        # Calculate statistics for ratio
        ratio_arr = np.array(ratios)
        ratio_stats = {
            "mean": round(float(np.mean(ratio_arr)), 2),
            "min": round(float(np.min(ratio_arr)), 2),
            "max": round(float(np.max(ratio_arr)), 2),
            "p75": round(float(np.percentile(ratio_arr, 75)), 2),
            "p90": round(float(np.percentile(ratio_arr, 90)), 2),
            "p95": round(float(np.percentile(ratio_arr, 95)), 2),
        }

        # Calculate statistics for volume
        vol_arr = np.array(volumes)
        volume_stats = {
            "mean": round(float(np.mean(vol_arr)), 0),
            "min": round(float(np.min(vol_arr)), 0),
            "max": round(float(np.max(vol_arr)), 0),
            "p25": round(float(np.percentile(vol_arr, 25)), 0),
            "p50": round(float(np.percentile(vol_arr, 50)), 0),
            "p75": round(float(np.percentile(vol_arr, 75)), 0),
        }

        time_range_hours = 0.0
        if sorted_times:
            time_range_hours = (sorted_times[-1] - sorted_times[0]) / (1000 * 60 * 60)

        # Convert log ratio suggestions back to multiplier for user-friendly display
        # User sets multiplier (e.g., 1.5), backend converts to log for comparison
        return {
            "status": "ok",
            "symbol": symbol,
            "metric": "taker_volume",
            "period": f"{interval_ms // 60000}m",
            "sample_count": len(ratios),
            "time_range_hours": round(time_range_hours, 1),
            "ratio_statistics": ratio_stats,  # Log values for display
            "volume_statistics": volume_stats,
            "suggestions": {
                "ratio": {
                    # Convert log values back to multiplier: exp(log_ratio)
                    "aggressive": round(math.exp(abs(ratio_stats["p75"])), 2),
                    "moderate": round(math.exp(abs(ratio_stats["p90"])), 2),
                    "conservative": round(math.exp(abs(ratio_stats["p95"])), 2)
                },
                "volume": {
                    "low": volume_stats["p25"],
                    "medium": volume_stats["p50"],
                    "high": volume_stats["p75"]
                }
            }
        }


# Singleton instance
signal_analysis_service = SignalAnalysisService()
