# Modified by QuantPilot contributors (2026). See NOTICE.
"""
Binance WebSocket Data Collector Service

Collects real-time market data from Binance WebSocket streams:
- @aggTrade: Aggregated trades for Taker Buy/Sell volume (15-second aggregation)

Data is aggregated in 15-second windows to match Hyperliquid's granularity.
Architecture mirrors market_flow_collector.py (Hyperliquid) exactly.
"""

import json
import time
import logging
import threading
from datetime import datetime, timezone
from decimal import Decimal
from typing import Dict, List, Optional
from dataclasses import dataclass, replace

from database.connection import SessionLocal
from database.models import MarketTradesAggregated
from services.exchanges.symbol_mapper import SymbolMapper
from services.large_order_threshold_tracker import LargeOrderThresholdTracker

logger = logging.getLogger(__name__)

# Aggregation window in seconds (same as Hyperliquid)
AGGREGATION_WINDOW_SECONDS = 15

# WebSocket settings
# aggTrade is a "market" category stream; the unrouted /ws endpoint accepts the
# subscription but never pushes it.
WS_URL = "wss://fstream.binance.com/market/ws"
RECONNECT_DELAY_SECONDS = 5
RECONNECT_MAX_DELAY_SECONDS = 60
WS_PING_INTERVAL_SECONDS = 30
WS_PING_TIMEOUT_SECONDS = 10
# Reconnect if no trade arrives for this long (connection open but silent)
WS_STALE_SECONDS = 60
THREAD_JOIN_TIMEOUT_SECONDS = 5


@dataclass
class TradeBuffer:
    """Buffer for aggregating trades within a time window (mirrors Hyperliquid's TradeBuffer)"""
    taker_buy_volume: Decimal = Decimal("0")
    taker_sell_volume: Decimal = Decimal("0")
    taker_buy_count: int = 0
    taker_sell_count: int = 0
    taker_buy_notional: Decimal = Decimal("0")
    taker_sell_notional: Decimal = Decimal("0")
    large_buy_notional: Decimal = Decimal("0")
    large_sell_notional: Decimal = Decimal("0")
    large_buy_count: int = 0
    large_sell_count: int = 0
    high_price: Optional[Decimal] = None
    low_price: Optional[Decimal] = None

    def reset(self):
        """Reset buffer for next window (no parameters, same as Hyperliquid)"""
        self.taker_buy_volume = Decimal("0")
        self.taker_sell_volume = Decimal("0")
        self.taker_buy_count = 0
        self.taker_sell_count = 0
        self.taker_buy_notional = Decimal("0")
        self.taker_sell_notional = Decimal("0")
        self.large_buy_notional = Decimal("0")
        self.large_sell_notional = Decimal("0")
        self.large_buy_count = 0
        self.large_sell_count = 0
        self.high_price = None
        self.low_price = None


class BinanceWSCollector:
    """
    WebSocket-based data collector for Binance.
    Architecture mirrors MarketFlowCollector (Hyperliquid) exactly:
    - threading + Timer (not asyncio)
    - flush uses floor(current_time) as timestamp
    - buffer.reset() with no parameters
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

        self.symbols: List[str] = []
        self.trade_buffers: Dict[str, TradeBuffer] = {}
        self.running = False
        self.flush_timer: Optional[threading.Timer] = None
        self.ws_thread: Optional[threading.Thread] = None
        self.buffer_lock = threading.Lock()
        self.large_order_tracker = LargeOrderThresholdTracker(exchange="binance")

        # Exchange symbol ("BTCUSDT") -> internal symbol ("BTC")
        self._stream_symbols: Dict[str, str] = {}
        self._ws = None
        # Bumped on every start/stop so leftover threads, callbacks and timers exit
        self._generation = 0
        # Set to cut the reconnect delay short (stop or symbol change)
        self._wake = threading.Event()

        # Health information
        self._connected = False
        self._last_message_monotonic: Optional[float] = None
        self._received_since_connect = False
        self._reconnect_count = 0
        self._last_connection_error: Optional[str] = None
        self._last_flush_at: Optional[str] = None
        self._last_flush_error: Optional[str] = None

        logger.info("BinanceWSCollector initialized")

    def start(self, symbols: Optional[List[str]] = None):
        """Start the WebSocket collector"""
        if self.running:
            logger.warning("BinanceWSCollector already running")
            return

        if symbols is None:
            from services.binance_symbol_service import get_selected_symbols
            symbols = get_selected_symbols() or ["BTC"]
            logger.info(f"[Binance WS] Using Binance watchlist symbols: {symbols}")

        self.large_order_tracker.initialize_from_history(symbols)
        with self.buffer_lock:
            self.trade_buffers = {}
            self._set_symbols(symbols)

        self._generation += 1
        generation = self._generation
        self._wake = threading.Event()
        self._last_message_monotonic = None
        self.running = True

        # Start WebSocket thread
        self.ws_thread = threading.Thread(
            target=self._ws_loop, args=(generation, self._wake), daemon=True
        )
        self.ws_thread.start()

        # Start flush timer with boundary alignment (same as Hyperliquid)
        # This ensures real-time detection matches backtest check_points
        self._schedule_flush(generation)

        logger.info(f"BinanceWSCollector started with symbols: {symbols}")

    def _set_symbols(self, symbols: List[str]):
        """Replace the symbol set, keeping buffered trades. Caller holds buffer_lock."""
        self.symbols = list(symbols)
        self.trade_buffers = {
            s: self.trade_buffers.get(s) or TradeBuffer() for s in self.symbols
        }
        self._stream_symbols = {
            SymbolMapper.to_exchange(s, "binance"): s for s in self.symbols
        }

    def _is_current(self, generation: int) -> bool:
        return self.running and generation == self._generation

    def _schedule_flush(self, generation: int, previous_boundary: int = 0):
        """
        Schedule next flush on a 15-second boundary.

        Why boundary alignment matters:
        - Real-time detection and backtest must use the same time boundaries
        - Backtest check_points are aligned to 15-second boundaries (00, 15, 30, 45)
        - If flush executes at non-aligned times (e.g., 13:52:28.234 instead of 13:52:30),
          the indicator values may differ slightly due to different data windows
        - This causes OR-logic signal pools to trigger differently in real-time vs backtest
        - By aligning flush to boundaries, real-time detection matches backtest exactly

        Args:
            generation: Collector run this timer chain belongs to.
            previous_boundary: Boundary (seconds) of the flush just done. A timer can
                              fire a few ms early, so the next one must be later
                              than this or the same window would be written twice.
        """
        if not self._is_current(generation):
            return

        # Calculate delay to next 15-second boundary
        now = time.time()
        current_boundary = int(now) // AGGREGATION_WINDOW_SECONDS * AGGREGATION_WINDOW_SECONDS
        next_boundary = max(current_boundary, previous_boundary) + AGGREGATION_WINDOW_SECONDS

        self.flush_timer = threading.Timer(
            next_boundary - now,
            self._flush_and_reschedule,
            args=(generation, next_boundary),
        )
        self.flush_timer.daemon = True
        self.flush_timer.start()

    def _flush_and_reschedule(self, generation: int, boundary: int):
        """Flush data and schedule next flush (mirrors Hyperliquid exactly)"""
        if not self._is_current(generation):
            return
        try:
            self._flush_to_database(boundary * 1000)
            self._reconnect_if_stale()
        finally:
            # Always re-align to boundary to prevent cumulative drift
            self._schedule_flush(generation, previous_boundary=boundary)

    def _ws_loop(self, generation: int, wake: threading.Event):
        """WebSocket connection loop running in separate thread"""
        delay = RECONNECT_DELAY_SECONDS

        while self._is_current(generation):
            wake.clear()
            self._received_since_connect = False
            try:
                self._connect_and_process(generation)
            except Exception as e:
                self._last_connection_error = str(e)
                logger.error(f"WebSocket error: {e}")

            if not self._is_current(generation):
                break
            self._connected = False
            self._reconnect_count += 1

            if wake.is_set():
                continue  # Symbols changed: reconnect immediately

            if self._received_since_connect:
                delay = RECONNECT_DELAY_SECONDS  # The last connection was healthy
            logger.warning(f"Binance WebSocket disconnected, reconnecting in {delay}s")
            if not wake.wait(delay):
                delay = min(delay * 2, RECONNECT_MAX_DELAY_SECONDS)

    def _connect_and_process(self, generation: int):
        """Connect to WebSocket and process messages"""
        import websocket

        def is_active(ws):
            return self._is_current(generation) and ws is self._ws

        def on_message(ws, message):
            if not is_active(ws):
                return
            try:
                data = json.loads(message)
                self._process_message(data)
            except Exception as e:
                logger.error(f"Message processing error: {e}")

        def on_error(ws, error):
            if is_active(ws):
                self._last_connection_error = str(error)
                logger.error(f"WebSocket error: {error}")

        def on_close(ws, close_status_code, close_msg):
            logger.info(f"WebSocket closed: {close_status_code} {close_msg}")

        def on_open(ws):
            if not is_active(ws):
                ws.close()
                return
            # Read symbols now so a change made while connecting is picked up
            with self.buffer_lock:
                streams = [f"{s.lower()}@aggTrade" for s in self._stream_symbols]
            self._connected = True
            self._last_connection_error = None
            self._last_message_monotonic = time.monotonic()
            if not streams:
                return
            subscribe_msg = {
                "method": "SUBSCRIBE",
                "params": streams,
                "id": 1
            }
            ws.send(json.dumps(subscribe_msg))
            logger.info(f"Subscribed to Binance streams: {streams}")

        ws = websocket.WebSocketApp(
            WS_URL,
            on_message=on_message,
            on_error=on_error,
            on_close=on_close,
            on_open=on_open
        )
        self._ws = ws
        if not self._is_current(generation):
            return

        # Run with ping interval to keep connection alive
        ws.run_forever(
            ping_interval=WS_PING_INTERVAL_SECONDS,
            ping_timeout=WS_PING_TIMEOUT_SECONDS,
        )

    def _close_connection(self):
        ws = self._ws
        if ws is None:
            return
        try:
            ws.close()
        except Exception as e:
            logger.warning(f"Failed to close Binance WebSocket: {e}")

    def _reconnect_if_stale(self):
        """Drop a connection that is open but no longer delivering trades"""
        if not self._connected or not self.symbols or self._last_message_monotonic is None:
            return
        silent_for = time.monotonic() - self._last_message_monotonic
        if silent_for > WS_STALE_SECONDS:
            logger.warning(f"No Binance trades for {silent_for:.0f}s, reconnecting")
            self._connected = False
            self._close_connection()

    def _process_message(self, data: dict):
        """Process incoming WebSocket message"""
        event_type = data.get("e")

        if event_type == "aggTrade":
            self._received_since_connect = True
            self._last_message_monotonic = time.monotonic()

            qty = Decimal(str(data["q"]))
            price = Decimal(str(data["p"]))
            is_buyer_maker = data["m"]
            notional = qty * price

            with self.buffer_lock:
                symbol = self._stream_symbols.get(data.get("s"))
                if symbol is None:
                    return
                buffer = self.trade_buffers[symbol]
                notional_float = float(notional)
                # Keep runtime work constant-time; threshold warm-start is
                # approximate and live trades refine it after startup.
                is_large = self.large_order_tracker.is_large_order(symbol, notional_float)
                self.large_order_tracker.update(symbol, notional_float)
                if is_buyer_maker:
                    # Buyer is maker = Taker is seller
                    buffer.taker_sell_volume += qty
                    buffer.taker_sell_notional += notional
                    buffer.taker_sell_count += 1
                    if is_large:
                        buffer.large_sell_notional += notional
                        buffer.large_sell_count += 1
                else:
                    # Seller is maker = Taker is buyer
                    buffer.taker_buy_volume += qty
                    buffer.taker_buy_notional += notional
                    buffer.taker_buy_count += 1
                    if is_large:
                        buffer.large_buy_notional += notional
                        buffer.large_buy_count += 1

                # Track high/low
                if buffer.high_price is None or price > buffer.high_price:
                    buffer.high_price = price
                if buffer.low_price is None or price < buffer.low_price:
                    buffer.low_price = price

    def _flush_to_database(self, boundary_ms: int = 0):
        """Flush all buffered data to database (mirrors Hyperliquid exactly)"""
        if not self.symbols:
            return

        # Calculate timestamp: floor(current_time) - same as Hyperliquid, but never
        # before the boundary this flush was scheduled for (early timer)
        timestamp_ms = int(time.time() * 1000)
        timestamp_ms = (timestamp_ms // (AGGREGATION_WINDOW_SECONDS * 1000)) * (AGGREGATION_WINDOW_SECONDS * 1000)
        timestamp_ms = max(timestamp_ms, boundary_ms)

        # Copy and reset under the lock; write outside it so the database never
        # blocks message processing
        pending = []
        with self.buffer_lock:
            for symbol, buffer in self.trade_buffers.items():
                if buffer.taker_buy_count or buffer.taker_sell_count:
                    pending.append((symbol, replace(buffer)))
                    buffer.reset()

        try:
            db = SessionLocal()
            try:
                for symbol, buffer in pending:
                    self._flush_trades(db, symbol, buffer, timestamp_ms)

                db.commit()
                if pending:
                    self._last_flush_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
                self._last_flush_error = None
                logger.debug(f"Flushed Binance trade data for {len(pending)} symbols")

                # Run signal detection after data flush (same as Hyperliquid)
                self._run_signal_detection()

            except Exception as e:
                db.rollback()
                self._last_flush_error = str(e)
                logger.error(f"Failed to flush Binance trade data: {e}")
            finally:
                db.close()

        except Exception as e:
            self._last_flush_error = str(e)
            logger.error(f"Database error in flush: {e}")

    def _flush_trades(self, db, symbol: str, buffer: TradeBuffer, timestamp_ms: int):
        """Write one symbol's buffered trades (mirrors Hyperliquid exactly)"""
        # Upsert: check if record exists, update or insert
        existing = db.query(MarketTradesAggregated).filter(
            MarketTradesAggregated.exchange == "binance",
            MarketTradesAggregated.symbol == symbol,
            MarketTradesAggregated.timestamp == timestamp_ms
        ).first()

        if existing:
            existing.taker_buy_volume = buffer.taker_buy_volume
            existing.taker_sell_volume = buffer.taker_sell_volume
            existing.taker_buy_count = buffer.taker_buy_count
            existing.taker_sell_count = buffer.taker_sell_count
            existing.taker_buy_notional = buffer.taker_buy_notional
            existing.taker_sell_notional = buffer.taker_sell_notional
            existing.large_buy_notional = buffer.large_buy_notional
            existing.large_sell_notional = buffer.large_sell_notional
            existing.large_buy_count = buffer.large_buy_count
            existing.large_sell_count = buffer.large_sell_count
            existing.high_price = buffer.high_price
            existing.low_price = buffer.low_price
        else:
            record = MarketTradesAggregated(
                exchange="binance",
                symbol=symbol,
                timestamp=timestamp_ms,
                taker_buy_volume=buffer.taker_buy_volume,
                taker_sell_volume=buffer.taker_sell_volume,
                taker_buy_count=buffer.taker_buy_count,
                taker_sell_count=buffer.taker_sell_count,
                taker_buy_notional=buffer.taker_buy_notional,
                taker_sell_notional=buffer.taker_sell_notional,
                large_buy_notional=buffer.large_buy_notional,
                large_sell_notional=buffer.large_sell_notional,
                large_buy_count=buffer.large_buy_count,
                large_sell_count=buffer.large_sell_count,
                high_price=buffer.high_price,
                low_price=buffer.low_price,
            )
            db.add(record)

    def _run_signal_detection(self):
        """Run signal detection for Binance pools only"""
        try:
            from services.signal_detection_service import signal_detection_service

            for symbol in list(self.symbols):
                # Binance detection doesn't need market_data context, queries DB directly
                market_data = {}
                triggered = signal_detection_service.detect_signals(
                    symbol, market_data, exchange="binance"
                )
                if triggered:
                    logger.info(f"Binance pools triggered for {symbol}: {[p['pool_name'] for p in triggered]}")

        except Exception as e:
            logger.error(f"Error in Binance signal detection: {e}", exc_info=True)

    def stop(self):
        """Stop the WebSocket collector"""
        if not self.running:
            return

        self.running = False
        self._generation += 1
        self._wake.set()

        if self.flush_timer:
            self.flush_timer.cancel()
            self.flush_timer = None

        self._close_connection()
        self._ws = None
        self._connected = False

        thread = self.ws_thread
        if thread and thread is not threading.current_thread():
            thread.join(timeout=THREAD_JOIN_TIMEOUT_SECONDS)
        self.ws_thread = None

        logger.info("BinanceWSCollector stopped")

    def refresh_symbols(self, new_symbols: List[str]):
        """Change subscriptions without losing trades buffered for kept symbols"""
        logger.info(f"Symbol refresh requested: {new_symbols}")
        if not self.running:
            self.start(new_symbols)
            return
        if set(new_symbols) == set(self.symbols):
            return

        added = [s for s in new_symbols if s not in self.symbols]
        if added:
            self.large_order_tracker.initialize_from_history(added)
        with self.buffer_lock:
            self._set_symbols(new_symbols)

        # The connection loop reconnects and subscribes to the new set
        self._wake.set()
        self._close_connection()

    def get_status(self) -> dict:
        """Return connection and persistence health."""
        silent_for = None
        if self._last_message_monotonic is not None:
            silent_for = round(time.monotonic() - self._last_message_monotonic, 1)
        return {
            "running": self.running,
            "connected": self._connected,
            "symbols": list(self.symbols),
            "seconds_since_last_message": silent_for,
            "reconnect_count": self._reconnect_count,
            "last_connection_error": self._last_connection_error,
            "last_flush_at": self._last_flush_at,
            "last_flush_error": self._last_flush_error,
        }


# Singleton instance
binance_ws_collector = BinanceWSCollector()
