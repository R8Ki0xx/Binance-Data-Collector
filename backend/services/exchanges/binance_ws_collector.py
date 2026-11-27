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
from decimal import Decimal
from typing import Dict, List, Optional
from dataclasses import dataclass

from database.connection import SessionLocal
from database.models import MarketTradesAggregated
from services.large_order_threshold_tracker import LargeOrderThresholdTracker

logger = logging.getLogger(__name__)

# Aggregation window in seconds (same as Hyperliquid)
AGGREGATION_WINDOW_SECONDS = 15

# WebSocket settings
WS_URL = "wss://fstream.binance.com/ws"
RECONNECT_DELAY_SECONDS = 5
WS_TIMEOUT_SECONDS = 30


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

        self.symbols = symbols
        self.trade_buffers = {s: TradeBuffer() for s in symbols}
        self.large_order_tracker.initialize_from_history(symbols)
        self.running = True

        # Start WebSocket thread
        self.ws_thread = threading.Thread(target=self._ws_loop, daemon=True)
        self.ws_thread.start()

        # Start flush timer with boundary alignment (same as Hyperliquid)
        # This ensures real-time detection matches backtest check_points
        self._schedule_flush(align_to_boundary=True)

        logger.info(f"BinanceWSCollector started with symbols: {symbols}")

    def _schedule_flush(self, align_to_boundary: bool = False):
        """
        Schedule next flush.

        Why align_to_boundary matters:
        - Real-time detection and backtest must use the same time boundaries
        - Backtest check_points are aligned to 15-second boundaries (00, 15, 30, 45)
        - If flush executes at non-aligned times (e.g., 13:52:28.234 instead of 13:52:30),
          the indicator values may differ slightly due to different data windows
        - This causes OR-logic signal pools to trigger differently in real-time vs backtest
        - By aligning flush to boundaries, real-time detection matches backtest exactly

        Args:
            align_to_boundary: If True, wait until next 15-second boundary before first flush.
                              Used on startup to sync with backtest check_points.
        """
        if not self.running:
            return

        delay = AGGREGATION_WINDOW_SECONDS
        if align_to_boundary:
            # Calculate delay to next 15-second boundary
            now = time.time()
            current_boundary = int(now) // AGGREGATION_WINDOW_SECONDS * AGGREGATION_WINDOW_SECONDS
            next_boundary = current_boundary + AGGREGATION_WINDOW_SECONDS
            delay = next_boundary - now
            logger.info(f"[Flush] Aligning to boundary, waiting {delay:.2f}s until next flush")

        self.flush_timer = threading.Timer(delay, self._flush_and_reschedule)
        self.flush_timer.daemon = True
        self.flush_timer.start()

    def _flush_and_reschedule(self):
        """Flush data and schedule next flush (mirrors Hyperliquid exactly)"""
        if not self.running:
            return
        self._flush_to_database()
        # Always re-align to boundary to prevent cumulative drift
        self._schedule_flush(align_to_boundary=True)

    def _ws_loop(self):
        """WebSocket connection loop running in separate thread"""
        import websocket

        while self.running:
            try:
                self._connect_and_process()
            except Exception as e:
                logger.error(f"WebSocket error: {e}")
                if self.running:
                    time.sleep(RECONNECT_DELAY_SECONDS)

    def _connect_and_process(self):
        """Connect to WebSocket and process messages"""
        import websocket

        # Build stream list
        streams = []
        for symbol in self.symbols:
            exchange_symbol = f"{symbol}usdt".lower()
            streams.append(f"{exchange_symbol}@aggTrade")

        def on_message(ws, message):
            try:
                data = json.loads(message)
                self._process_message(data)
            except Exception as e:
                logger.error(f"Message processing error: {e}")

        def on_error(ws, error):
            logger.error(f"WebSocket error: {error}")

        def on_close(ws, close_status_code, close_msg):
            logger.warning(f"WebSocket closed: {close_status_code} {close_msg}")

        def on_open(ws):
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

        # Run with ping interval to keep connection alive
        ws.run_forever(ping_interval=WS_TIMEOUT_SECONDS)

    def _process_message(self, data: dict):
        """Process incoming WebSocket message"""
        event_type = data.get("e")

        if event_type == "aggTrade":
            symbol = data.get("s", "").replace("USDT", "")
            if symbol in self.trade_buffers:
                qty = Decimal(str(data["q"]))
                price = Decimal(str(data["p"]))
                is_buyer_maker = data["m"]
                notional = qty * price

                with self.buffer_lock:
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

    def _flush_to_database(self):
        """Flush all buffered data to database (mirrors Hyperliquid exactly)"""
        if not self.symbols:
            return

        # Calculate timestamp: floor(current_time) - same as Hyperliquid
        timestamp_ms = int(time.time() * 1000)
        timestamp_ms = (timestamp_ms // (AGGREGATION_WINDOW_SECONDS * 1000)) * (AGGREGATION_WINDOW_SECONDS * 1000)

        try:
            db = SessionLocal()
            try:
                for symbol in self.symbols:
                    self._flush_trades(db, symbol, timestamp_ms)

                db.commit()
                logger.debug(f"Flushed Binance trade data for {len(self.symbols)} symbols")

                # Run signal detection after data flush (same as Hyperliquid)
                self._run_signal_detection()

            except Exception as e:
                db.rollback()
                logger.error(f"Failed to flush Binance trade data: {e}")
            finally:
                db.close()

        except Exception as e:
            logger.error(f"Database error in flush: {e}")

    def _flush_trades(self, db, symbol: str, timestamp_ms: int):
        """Flush trade buffer for a symbol (mirrors Hyperliquid exactly)"""
        with self.buffer_lock:
            buffer = self.trade_buffers.get(symbol)
            if not buffer or (buffer.taker_buy_count == 0 and buffer.taker_sell_count == 0):
                return

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

            # Reset buffer (no parameters, same as Hyperliquid)
            buffer.reset()

    def _run_signal_detection(self):
        """Run signal detection for Binance pools only"""
        try:
            from services.signal_detection_service import signal_detection_service

            for symbol in self.symbols:
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

        if self.flush_timer:
            self.flush_timer.cancel()
            self.flush_timer = None

        logger.info("BinanceWSCollector stopped")

    def refresh_symbols(self, new_symbols: List[str]):
        """Update symbols - requires restart"""
        logger.info(f"Symbol refresh requested: {new_symbols}")
        self.stop()
        time.sleep(1)  # Brief pause before restart
        self.start(new_symbols)


# Singleton instance
binance_ws_collector = BinanceWSCollector()
