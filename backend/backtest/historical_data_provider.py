"""
Historical Data Provider for Backtest

Provides historical market data for backtesting.
Interface compatible with DataProvider for strategy code reuse.
"""

import logging
from typing import Dict, List, Any, Optional
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from sqlalchemy import text

logger = logging.getLogger(__name__)


class HistoricalDataProvider:
    """
    Provides historical data for backtesting.

    Key differences from DataProvider:
    - Reads from database instead of real-time API
    - Filters data by current_time_ms (only data before this time)
    - Used by backtest engine to simulate historical market state
    - Tracks data queries for logging
    """

    def __init__(
        self,
        db: Session,
        symbols: List[str],
        start_time_ms: int,
        end_time_ms: int,
        exchange: str = "hyperliquid",
    ):
        """
        Initialize historical data provider.

        Args:
            db: Database session
            symbols: List of symbols to load data for
            start_time_ms: Backtest start time (milliseconds)
            end_time_ms: Backtest end time (milliseconds)
            exchange: Exchange to use for data (default: hyperliquid)
        """
        self.db = db
        self.symbols = symbols
        self.start_time_ms = start_time_ms
        self.end_time_ms = end_time_ms
        self.current_time_ms = start_time_ms
        self.exchange = exchange

        # Caches
        self._kline_cache: Dict[str, List[Dict]] = {}
        self._flow_cache: Dict[str, Dict] = {}
        self._price_cache: Dict[str, float] = {}

        # Query tracking for logging
        self._query_log: List[Dict[str, Any]] = []

        # Preload data for better performance
        self._preload_data()

    def _preload_data(self):
        """Preload all kline data for symbols to avoid repeated DB queries."""
        logger.info(f"Preloading data for {len(self.symbols)} symbols...")

        for symbol in self.symbols:
            # Preload common periods (1m for price accuracy, others for indicators)
            for period in ["1m", "5m", "15m", "1h", "4h", "1d"]:
                self._load_klines_to_cache(symbol, period)

        logger.info(f"Preload complete. Cache size: {len(self._kline_cache)} entries")

    def set_current_time(self, timestamp_ms: int):
        """Set current simulation time."""
        self.current_time_ms = timestamp_ms
        # Clear price cache when time changes
        self._price_cache = {}

    def clear_query_log(self):
        """Clear query log for new trigger."""
        self._query_log = []

    def get_query_log(self) -> List[Dict[str, Any]]:
        """Get list of data queries made since last clear."""
        return self._query_log.copy()

    def _log_query(self, method: str, args: Dict[str, Any], result: Any):
        """Log a data query with full result for debugging.

        Args:
            method: Query method name (e.g., 'get_klines', 'get_indicator')
            args: Query arguments dict
            result: Query result (will be serialized)
        """
        self._query_log.append({
            "method": method,
            "args": args,
            "result": result
        })

    def get_current_prices(self, symbols: List[str] = None) -> Dict[str, float]:
        """Get current prices for symbols at current_time_ms."""
        target_symbols = symbols or self.symbols
        prices = {}

        for symbol in target_symbols:
            if symbol in self._price_cache:
                prices[symbol] = self._price_cache[symbol]
                continue

            price = self._get_price_at_time(symbol, self.current_time_ms)
            if price:
                prices[symbol] = price
                self._price_cache[symbol] = price

        return prices

    def _get_price_at_time(self, symbol: str, timestamp_ms: int) -> Optional[float]:
        """Get price at specific timestamp.

        Priority:
        1. market_asset_metrics.mark_price (15-second granularity, most accurate)
        2. 1m kline close price (fallback)
        """
        # Try market_asset_metrics first (15-second granularity)
        try:
            result = self.db.execute(text("""
                SELECT mark_price FROM market_asset_metrics
                WHERE symbol = :symbol AND exchange = :exchange
                AND timestamp <= :ts
                ORDER BY timestamp DESC LIMIT 1
            """), {"symbol": symbol, "exchange": self.exchange, "ts": timestamp_ms})
            row = result.fetchone()
            if row and row[0]:
                return float(row[0])
        except Exception as e:
            logger.debug(f"Failed to get mark_price for {symbol}: {e}")

        # Fallback to 1m kline close price
        timestamp_sec = timestamp_ms // 1000
        cache_key = f"{symbol}_1m"

        if cache_key in self._kline_cache:
            klines = self._kline_cache[cache_key]
            for k in reversed(klines):
                if k["timestamp"] <= timestamp_sec:
                    return k["close"]
            if klines:
                return klines[0]["close"]

        # Final fallback: DB query for kline
        try:
            result = self.db.execute(text("""
                SELECT close_price FROM crypto_klines
                WHERE symbol = :symbol AND period = '1m' AND exchange = :exchange
                AND timestamp <= :ts
                ORDER BY timestamp DESC LIMIT 1
            """), {"symbol": symbol, "exchange": self.exchange, "ts": timestamp_sec})
            row = result.fetchone()
            if row:
                return float(row[0])
        except Exception as e:
            logger.warning(f"Failed to get price for {symbol}: {e}")

        return None

    def get_klines(self, symbol: str, period: str, count: int = 50) -> List[Any]:
        """
        Get historical K-line data up to current_time_ms.

        Returns Kline objects compatible with DataProvider.
        Includes a virtual "current" K-line built from 15-second mark_price data
        to match real-time API behavior (which returns incomplete current candle).
        """
        from program_trader.models import Kline

        timestamp_sec = self.current_time_ms // 1000
        cache_key = f"{symbol}_{period}"

        # Load and cache all klines for this symbol/period if not cached
        if cache_key not in self._kline_cache:
            self._load_klines_to_cache(symbol, period)

        # Filter klines up to current time and return last 'count'
        all_klines = self._kline_cache.get(cache_key, [])
        filtered = [k for k in all_klines if k["timestamp"] <= timestamp_sec]

        # Build virtual current K-line to match real-time API behavior
        virtual_kline = self._build_virtual_kline(symbol, period, timestamp_sec)
        if virtual_kline:
            # Check if we need to replace or append
            if filtered and filtered[-1]["timestamp"] == virtual_kline["timestamp"]:
                # Same period start - replace with virtual (more up-to-date price)
                # Preserve real volume since virtual kline has no volume data
                virtual_kline["volume"] = filtered[-1]["volume"]
                filtered[-1] = virtual_kline
            else:
                # New period - append virtual kline
                filtered.append(virtual_kline)

        # Convert to Kline objects
        result = []
        for k in filtered[-count:]:
            result.append(Kline(
                timestamp=k["timestamp"],
                open=k["open"],
                high=k["high"],
                low=k["low"],
                close=k["close"],
                volume=k["volume"],
            ))

        # Log query with result summary (last kline info)
        result_summary = None
        if result:
            last_k = result[-1]
            result_summary = {
                "count": len(result),
                "last": {"timestamp": last_k.timestamp, "close": last_k.close}
            }
        self._log_query("get_klines", {"symbol": symbol, "period": period, "count": count, "exchange": self.exchange}, result_summary)

        return result

    def _load_klines_to_cache(self, symbol: str, period: str):
        """Load all klines for symbol/period into cache.

        If database has insufficient data, automatically fetch from API and persist.
        """
        cache_key = f"{symbol}_{period}"

        # Calculate time range with buffer for indicator calculation
        period_seconds = {
            "1m": 60, "5m": 300, "15m": 900, "30m": 1800,
            "1h": 3600, "2h": 7200, "4h": 14400, "8h": 28800,
            "12h": 43200, "1d": 86400
        }
        period_sec = period_seconds.get(period, 300)  # default to 5m
        buffer_seconds = 500 * period_sec

        start_sec = (self.start_time_ms // 1000) - buffer_seconds
        end_sec = self.end_time_ms // 1000

        # Minimum required klines for indicator calculation (EMA100 needs ~150)
        min_required = 150

        try:
            # First, query from database
            klines = self._query_klines_from_db(symbol, period, start_sec, end_sec)

            # Check if data is sufficient:
            # 1. Need at least min_required klines for indicator calculation
            # 2. Data must cover close to end_time (gap < 2 periods means OK)
            needs_fetch = False
            if len(klines) < min_required:
                needs_fetch = True
                logger.warning(
                    f"[Backtest] Insufficient kline data for {symbol}/{period}/{self.exchange}: "
                    f"got {len(klines)}, need {min_required}. Fetching from API..."
                )
            elif klines:
                # Check if latest kline is too far from end_time
                latest_ts = klines[-1]["timestamp"]
                gap_periods = (end_sec - latest_ts) / period_sec
                if gap_periods > 2:
                    needs_fetch = True
                    logger.warning(
                        f"[Backtest] Kline data gap for {symbol}/{period}/{self.exchange}: "
                        f"latest={latest_ts}, end={end_sec}, gap={gap_periods:.0f} periods. Fetching from API..."
                    )

            if needs_fetch:
                # Fetch from API by time range and persist to database
                fetched = self._fetch_and_persist_klines(
                    symbol, period,
                    since_ms=start_sec * 1000,
                    until_ms=end_sec * 1000
                )

                if fetched:
                    logger.info(
                        f"[Backtest] Fetched {len(fetched)} klines for {symbol}/{period}/{self.exchange} from API"
                    )
                    # Re-query from database to get persisted data
                    klines = self._query_klines_from_db(symbol, period, start_sec, end_sec)
                    logger.info(f"[Backtest] After sync: {len(klines)} klines available")
                else:
                    logger.error(
                        f"[Backtest] Failed to fetch klines for {symbol}/{period}/{self.exchange} from API"
                    )

            self._kline_cache[cache_key] = klines
            logger.debug(f"Loaded {len(klines)} klines for {symbol} {period}")

        except Exception as e:
            logger.error(f"Failed to load klines for {symbol} {period}: {e}")
            self._kline_cache[cache_key] = []

    def _query_klines_from_db(self, symbol: str, period: str, start_sec: int, end_sec: int) -> list:
        """Query klines from database."""
        result = self.db.execute(text("""
            SELECT timestamp, open_price, high_price, low_price, close_price, volume
            FROM crypto_klines
            WHERE symbol = :symbol AND period = :period AND exchange = :exchange
            AND timestamp >= :start_ts AND timestamp <= :end_ts
            ORDER BY timestamp ASC
        """), {"symbol": symbol, "period": period, "exchange": self.exchange,
               "start_ts": start_sec, "end_ts": end_sec})

        klines = []
        for row in result:
            klines.append({
                "timestamp": int(row[0]),
                "open": float(row[1]),
                "high": float(row[2]),
                "low": float(row[3]),
                "close": float(row[4]),
                "volume": float(row[5]) if row[5] else 0.0,
            })
        return klines

    def _fetch_and_persist_klines(
        self, symbol: str, period: str,
        since_ms: int = None, until_ms: int = None, count: int = 500
    ) -> list:
        """Fetch klines from API by time range and persist to database.

        Uses time-range API to get historical data matching the backtest window,
        then backfills to database for future reuse.

        Args:
            symbol: Trading symbol
            period: K-line period
            since_ms: Start timestamp in milliseconds (defaults to calculated range)
            until_ms: End timestamp in milliseconds (defaults to end_time_ms)
            count: Fallback count if since_ms not provided
        """
        if until_ms is None:
            until_ms = self.end_time_ms
        if since_ms is None:
            period_seconds = {
                "1m": 60, "5m": 300, "15m": 900, "30m": 1800,
                "1h": 3600, "2h": 7200, "4h": 14400, "8h": 28800,
                "12h": 43200, "1d": 86400
            }
            period_sec = period_seconds.get(period, 300)
            since_ms = until_ms - (count * period_sec * 1000)

        try:
            if self.exchange == "binance":
                return self._fetch_binance_klines(symbol, period, since_ms, until_ms)
            else:
                return self._fetch_hyperliquid_klines(symbol, period, since_ms, until_ms)
        except Exception as e:
            logger.error(f"Failed to fetch klines from API for {symbol}/{period}/{self.exchange}: {e}")
            return []

    def _fetch_hyperliquid_klines(self, symbol, period, since_ms, until_ms):
        """Fetch Hyperliquid klines by time range and persist."""
        from services.hyperliquid_market_data import get_historical_kline_data_from_hyperliquid
        klines = get_historical_kline_data_from_hyperliquid(
            symbol=symbol, period=period,
            since_ms=since_ms, until_ms=until_ms,
            environment="mainnet"
        )
        if klines:
            self._persist_klines_to_db(symbol, period, klines, "hyperliquid")
        return klines or []

    def _fetch_binance_klines(self, symbol, period, since_ms, until_ms):
        """Fetch Binance klines by time range and persist."""
        from services.exchanges.binance_adapter import BinanceAdapter
        adapter = BinanceAdapter(environment="mainnet")
        unified_klines = adapter.fetch_klines(
            symbol=symbol, interval=period, limit=500,
            start_time=since_ms, end_time=until_ms
        )
        if not unified_klines:
            return []
        klines = [
            {
                "timestamp": k.timestamp,
                "open": float(k.open_price),
                "high": float(k.high_price),
                "low": float(k.low_price),
                "close": float(k.close_price),
                "volume": float(k.volume),
            }
            for k in unified_klines
        ]
        self._persist_klines_to_db(symbol, period, klines, "binance")
        return klines

    def _persist_klines_to_db(self, symbol: str, period: str, klines: list, exchange: str):
        """Persist klines to database (works for both Hyperliquid and Binance)."""
        from database.models import CryptoKline

        try:
            inserted = 0
            for k in klines:
                ts = k.get("timestamp") or k.get("timestamp", 0)
                # Handle both seconds and milliseconds timestamps
                ts_sec = ts if ts < 1e12 else ts // 1000
                dt = datetime.fromtimestamp(ts_sec, tz=timezone.utc)
                datetime_str = dt.strftime("%Y-%m-%d %H:%M:%S")

                existing = self.db.query(CryptoKline).filter(
                    CryptoKline.symbol == symbol,
                    CryptoKline.period == period,
                    CryptoKline.exchange == exchange,
                    CryptoKline.timestamp == ts_sec,
                ).first()

                if not existing:
                    record = CryptoKline(
                        exchange=exchange,
                        symbol=symbol,
                        market="CRYPTO",
                        period=period,
                        timestamp=ts_sec,
                        datetime_str=datetime_str,
                        environment="mainnet",
                        open_price=float(k.get("open", 0) or 0),
                        high_price=float(k.get("high", 0) or 0),
                        low_price=float(k.get("low", 0) or 0),
                        close_price=float(k.get("close", 0) or 0),
                        volume=float(k.get("volume", 0) or 0),
                    )
                    self.db.add(record)
                    inserted += 1

            self.db.commit()
            logger.info(f"Persisted {inserted}/{len(klines)} {exchange} klines for {symbol}/{period}")

        except Exception as e:
            logger.error(f"Failed to persist {exchange} klines: {e}")
            self.db.rollback()

    def _build_virtual_kline(self, symbol: str, period: str, current_time_sec: int) -> Optional[Dict]:
        """Build a virtual K-line for the current incomplete period.

        Real-time API returns the current incomplete K-line with close=current_price.
        To match this behavior, we build a virtual K-line from market_asset_metrics
        (15-second granularity mark_price data).

        Args:
            symbol: Trading symbol
            period: K-line period (1m, 5m, 15m, 1h, 4h, 1d)
            current_time_sec: Current simulation time in seconds

        Returns:
            Virtual K-line dict or None if insufficient data
        """
        period_seconds = {
            "1m": 60, "5m": 300, "15m": 900, "30m": 1800,
            "1h": 3600, "4h": 14400, "1d": 86400
        }
        period_sec = period_seconds.get(period)
        if not period_sec:
            return None

        # Calculate current period start time
        period_start_sec = (current_time_sec // period_sec) * period_sec
        period_start_ms = period_start_sec * 1000
        current_time_ms = current_time_sec * 1000

        # Query mark_price data within current period
        try:
            result = self.db.execute(text("""
                SELECT timestamp, mark_price
                FROM market_asset_metrics
                WHERE symbol = :symbol AND exchange = :exchange
                AND timestamp >= :start_ms AND timestamp <= :end_ms
                ORDER BY timestamp ASC
            """), {
                "symbol": symbol,
                "exchange": self.exchange,
                "start_ms": period_start_ms,
                "end_ms": current_time_ms
            })

            prices = []
            for row in result:
                if row[1]:
                    prices.append(float(row[1]))

            if not prices:
                return None

            # Build OHLC from price series
            return {
                "timestamp": period_start_sec,
                "open": prices[0],
                "high": max(prices),
                "low": min(prices),
                "close": prices[-1],
                "volume": 0.0,  # Volume not available from mark_price
            }

        except Exception as e:
            logger.debug(f"Failed to build virtual kline for {symbol} {period}: {e}")
            return None

    def get_indicator(self, symbol: str, indicator: str, period: str) -> Dict[str, Any]:
        """
        Calculate technical indicator from historical klines.

        Uses same calculation as DataProvider for consistency.
        """
        from services.technical_indicators import calculate_indicators

        # Get klines (enough for indicator calculation)
        klines = self.get_klines(symbol, period, 500)
        if not klines:
            self._log_query("get_indicator", {"symbol": symbol, "indicator": indicator, "period": period, "exchange": self.exchange}, {})
            return {}

        # Convert to format expected by calculate_indicators
        kline_data = [
            {
                "timestamp": k.timestamp,
                "open": k.open,
                "high": k.high,
                "low": k.low,
                "close": k.close,
                "volume": k.volume,
            }
            for k in klines
        ]

        result = {}
        try:
            indicator_upper = indicator.upper()
            calculated = calculate_indicators(kline_data, [indicator_upper])

            if indicator_upper in calculated and calculated[indicator_upper] is not None:
                value = calculated[indicator_upper]
                if isinstance(value, list):
                    result = {'value': value[-1] if value else None, 'series': value}
                elif isinstance(value, dict):
                    latest = {}
                    for k, v in value.items():
                        if isinstance(v, list) and v:
                            latest[k] = v[-1]
                        else:
                            latest[k] = v
                    result = latest
                else:
                    result = {'value': value}
        except Exception as e:
            logger.warning(f"Failed to calculate {indicator} for {symbol}: {e}")

        # Log with result (exclude series to save space)
        log_result = {k: v for k, v in result.items() if k != 'series'} if result else {}
        self._log_query("get_indicator", {"symbol": symbol, "indicator": indicator, "period": period, "exchange": self.exchange}, log_result)

        return result

    def get_flow(self, symbol: str, metric: str, period: str) -> Dict[str, Any]:
        """
        Get historical flow data (CVD, OI, TAKER, etc.).

        Queries aggregated market data tables.
        """
        from services.market_flow_indicators import get_flow_indicators_for_prompt

        result = {}
        try:
            results = get_flow_indicators_for_prompt(
                self.db, symbol, period, [metric.upper()], self.current_time_ms,
                exchange=self.exchange
            )
            result = results.get(metric.upper(), {}) or {}
        except Exception as e:
            logger.warning(f"Failed to get flow {metric} for {symbol}: {e}")

        self._log_query("get_flow", {"symbol": symbol, "metric": metric, "period": period, "exchange": self.exchange}, result)
        return result

    def get_regime(self, symbol: str, period: str) -> Any:
        """
        Get market regime at current time.

        Uses historical data to calculate regime.
        """
        from program_trader.models import RegimeInfo
        from services.market_regime_service import get_market_regime

        regime_info = RegimeInfo(regime="noise", conf=0.0)
        log_result = {"regime": "noise", "conf": 0.0}

        try:
            result = get_market_regime(
                self.db, symbol, period,
                use_realtime=True,
                timestamp_ms=self.current_time_ms,
                exchange=self.exchange
            )
            if result:
                regime_info = RegimeInfo(
                    regime=result.get("regime", "noise"),
                    conf=result.get("confidence", 0.0),
                    direction=result.get("direction", "neutral"),
                    reason=result.get("reason", ""),
                    indicators=result.get("indicators", {}),
                )
                log_result = {
                    "regime": regime_info.regime,
                    "conf": regime_info.conf,
                    "direction": regime_info.direction,
                    "indicators": regime_info.indicators,
                }
        except Exception as e:
            logger.warning(f"Failed to get regime for {symbol}: {e}")

        self._log_query("get_regime", {"symbol": symbol, "period": period, "exchange": self.exchange}, log_result)
        return regime_info

    def get_price_change(self, symbol: str, period: str) -> Dict[str, float]:
        """Get price change over period.

        Returns:
            Dict with change_percent (percentage) and change_usd (absolute USD change)
        """
        from services.market_flow_indicators import get_flow_indicators_for_prompt

        result = {"change_percent": 0.0, "change_usd": 0.0}
        try:
            results = get_flow_indicators_for_prompt(
                self.db, symbol, period, ["PRICE_CHANGE"], self.current_time_ms,
                exchange=self.exchange
            )
            data = results.get("PRICE_CHANGE")
            if data:
                change_pct = data.get("current", 0.0)
                start_price = data.get("start_price", 0.0)
                end_price = data.get("end_price", 0.0)
                change_usd = (end_price - start_price) if start_price and end_price else 0.0
                result = {
                    "change_percent": change_pct,
                    "change_usd": change_usd,
                }
        except Exception:
            pass

        self._log_query("get_price_change", {"symbol": symbol, "period": period, "exchange": self.exchange}, result)
        return result

    def get_market_data(self, symbol: str) -> Dict[str, Any]:
        """Get market data snapshot at current time."""
        price = self._get_price_at_time(symbol, self.current_time_ms)
        result = {"symbol": symbol, "price": price or 0.0}

        # Get additional data from market_asset_metrics if available.
        # Binance stores mark_price and open_interest in separate rows
        # (timestamps differ by ~1ms), so we fetch each field's latest
        # non-null value independently instead of relying on a single row.
        try:
            mark_price_val = None
            funding_rate_val = None
            oi_val = None

            row_mp = self.db.execute(text("""
                SELECT mark_price, funding_rate
                FROM market_asset_metrics
                WHERE symbol = :symbol AND exchange = :exchange
                AND timestamp <= :ts AND mark_price IS NOT NULL
                ORDER BY timestamp DESC LIMIT 1
            """), {"symbol": symbol, "exchange": self.exchange, "ts": self.current_time_ms}).fetchone()
            if row_mp:
                mark_price_val = float(row_mp[0] or 0)
                funding_rate_val = float(row_mp[1] or 0)

            row_oi = self.db.execute(text("""
                SELECT open_interest
                FROM market_asset_metrics
                WHERE symbol = :symbol AND exchange = :exchange
                AND timestamp <= :ts AND open_interest IS NOT NULL
                ORDER BY timestamp DESC LIMIT 1
            """), {"symbol": symbol, "exchange": self.exchange, "ts": self.current_time_ms}).fetchone()
            if row_oi:
                oi_val = float(row_oi[0] or 0)

            if mark_price_val is not None or oi_val is not None:
                result = {
                    "symbol": symbol,
                    "price": price or (mark_price_val or 0),
                    "mark_price": mark_price_val or 0,
                    "funding_rate": funding_rate_val or 0,
                    "open_interest": oi_val or 0,
                }
        except Exception as e:
            logger.warning(f"Failed to get market data for {symbol}: {e}")

        self._log_query("get_market_data", {"symbol": symbol, "exchange": self.exchange}, result)
        return result

    def get_factor(self, symbol: str, factor_name: str, period: str = "5m") -> Dict[str, Any]:
        """Get factor value at the current backtest timestamp.

        Sync rule: keep factor value calculation aligned with Program live
        get_factor() and Prompt factor variables. Only the data source differs:
        backtest uses historical K-lines constrained by current_time_ms.
        """
        from program_trader.data_provider import compute_factor_snapshot

        result = compute_factor_snapshot(
            db=self.db,
            symbol=symbol,
            factor_name=factor_name,
            period=period,
            exchange=self.exchange,
            klines_loader=lambda requested_period, count: [
                {
                    "timestamp": k.timestamp,
                    "open": k.open,
                    "high": k.high,
                    "low": k.low,
                    "close": k.close,
                    "volume": k.volume,
                }
                for k in self.get_klines(symbol, requested_period, count)
            ],
            include_effectiveness=False,
        )
        self._log_query("get_factor", {"symbol": symbol, "factor_name": factor_name, "period": period, "exchange": self.exchange}, result)
        return result

    def get_klines_between(
        self,
        symbol: str,
        start_time_ms: int,
        end_time_ms: int,
        period: str = "5m"
    ) -> List[Dict[str, Any]]:
        """
        Get K-lines between two timestamps for TP/SL checking.

        Returns raw dict format with high/low for checking price extremes.

        Args:
            symbol: Trading symbol
            start_time_ms: Start timestamp (exclusive, after this time)
            end_time_ms: End timestamp (inclusive, up to this time)
            period: K-line period (default 5m for balance of accuracy and performance)

        Returns:
            List of kline dicts with timestamp, high, low, close
        """
        cache_key = f"{symbol}_{period}"

        # Load cache if not exists
        if cache_key not in self._kline_cache:
            self._load_klines_to_cache(symbol, period)

        all_klines = self._kline_cache.get(cache_key, [])

        # Convert to seconds for comparison
        start_sec = start_time_ms // 1000
        end_sec = end_time_ms // 1000

        # Filter klines in range (start exclusive, end inclusive)
        result = [
            k for k in all_klines
            if start_sec < k["timestamp"] <= end_sec
        ]

        return result

