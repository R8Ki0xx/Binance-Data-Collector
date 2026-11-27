"""
Binance Futures Trading Client

Handles trading operations on Binance USDS-M Futures via REST API.
Supports both testnet and mainnet environments.
"""

import hashlib
import hmac
import logging
import time
import requests
from datetime import datetime
from decimal import Decimal, ROUND_DOWN
from typing import Dict, Any, Optional, List
from urllib.parse import urlencode

from config.settings import BINANCE_BROKER_CONFIG

logger = logging.getLogger(__name__)


class BinanceTradingClient:
    """
    Binance Futures trading client with HMAC authentication.

    Supports:
    - Account balance and position queries
    - Leverage configuration
    - Market/Limit order placement
    - Stop-loss and take-profit orders
    """

    # API Endpoints
    MAINNET_BASE_URL = "https://fapi.binance.com"
    TESTNET_BASE_URL = "https://demo-fapi.binance.com"
    DEFAULT_RECV_WINDOW = 10000
    SERVER_TIME_SYNC_TTL_SECONDS = 30

    def __init__(
        self,
        api_key: str,
        secret_key: str,
        environment: str = "testnet"
    ):
        """
        Initialize Binance trading client.

        Args:
            api_key: Binance API key
            secret_key: Binance secret key
            environment: 'testnet' or 'mainnet'
        """
        self.api_key = api_key
        self.secret_key = secret_key
        self.environment = environment
        self.base_url = self.TESTNET_BASE_URL if environment == "testnet" else self.MAINNET_BASE_URL
        self.broker_id = BINANCE_BROKER_CONFIG.broker_id

        # Session for connection pooling
        self.session = requests.Session()
        self.session.headers.update({
            "X-MBX-APIKEY": self.api_key,
            "Content-Type": "application/x-www-form-urlencoded"
        })

        # Cache for exchange info (precision data)
        self._exchange_info_cache: Optional[Dict] = None
        self._exchange_info_timestamp: float = 0
        self._cache_ttl = 3600  # 1 hour

        # Rate limit tracking (from response headers)
        self._last_used_weight: int = 0
        self._weight_cap: int = 2400  # Binance Futures default

        # Signed requests need Binance server-aligned timestamps.
        self._timestamp_offset_ms: int = 0
        self._server_time_synced_at: float = 0.0

        logger.info(f"[BINANCE] Client initialized for {environment}")

    def _get_local_timestamp(self) -> int:
        """Get local system timestamp in milliseconds."""
        return int(time.time() * 1000)

    def _get_timestamp(self) -> int:
        """Get Binance-aligned timestamp in milliseconds."""
        return self._get_local_timestamp() + self._timestamp_offset_ms

    def _sync_server_time(self, force: bool = False) -> int:
        """
        Sync local timestamp offset against Binance server time.

        Uses the midpoint between request start/end to reduce the impact of
        network latency on the offset estimate.
        """
        now = time.time()
        if not force and self._server_time_synced_at and (
            now - self._server_time_synced_at
        ) < self.SERVER_TIME_SYNC_TTL_SECONDS:
            return self._timestamp_offset_ms

        url = f"{self.base_url}/fapi/v1/time"
        request_start_ms = self._get_local_timestamp()
        response = self.session.get(url, timeout=5)
        request_end_ms = self._get_local_timestamp()
        response.raise_for_status()

        payload = response.json()
        server_time_ms = int(payload["serverTime"])
        midpoint_ms = (request_start_ms + request_end_ms) // 2

        self._timestamp_offset_ms = server_time_ms - midpoint_ms
        self._server_time_synced_at = time.time()

        logger.debug(
            "[BINANCE] Synced server time offset: %sms (round trip %sms)",
            self._timestamp_offset_ms,
            request_end_ms - request_start_ms,
        )
        return self._timestamp_offset_ms

    def _sign(self, params: Dict[str, Any]) -> str:
        """
        Generate HMAC SHA256 signature for request parameters.

        Args:
            params: Request parameters dict

        Returns:
            Hex-encoded signature string
        """
        query_string = urlencode(params)
        signature = hmac.new(
            self.secret_key.encode('utf-8'),
            query_string.encode('utf-8'),
            hashlib.sha256
        ).hexdigest()
        return signature

    def _prepare_signed_params(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Build a fresh signed params dict with Binance-aligned timestamp."""
        signed_params = dict(params)
        signed_params["timestamp"] = self._get_timestamp()
        signed_params["recvWindow"] = self.DEFAULT_RECV_WINDOW
        signed_params["signature"] = self._sign(signed_params)
        return signed_params

    def _is_timestamp_error(self, error_code: Any, error_msg: Any) -> bool:
        """Return True when Binance rejects the request due to timestamp drift."""
        return str(error_code) == "-1021" or "recvWindow" in str(error_msg)

    def _request(
        self,
        method: str,
        endpoint: str,
        params: Optional[Dict[str, Any]] = None,
        signed: bool = False
    ) -> Dict[str, Any]:
        """
        Make HTTP request to Binance API.

        Args:
            method: HTTP method ('GET' or 'POST')
            endpoint: API endpoint path
            params: Request parameters
            signed: Whether to sign the request

        Returns:
            JSON response as dict

        Raises:
            Exception: On API error
        """
        url = f"{self.base_url}{endpoint}"
        base_params = dict(params or {})
        max_attempts = 2 if signed else 1

        for attempt in range(max_attempts):
            request_params = dict(base_params)

            try:
                if signed:
                    self._sync_server_time(force=(attempt > 0))
                    request_params = self._prepare_signed_params(request_params)

                if method == "GET":
                    response = self.session.get(url, params=request_params, timeout=10)
                elif method == "DELETE":
                    response = self.session.delete(url, params=request_params, timeout=10)
                else:
                    response = self.session.post(url, data=request_params, timeout=10)

                # Log rate limit info and save to instance
                used_weight = response.headers.get("X-MBX-USED-WEIGHT-1M", "0")
                try:
                    self._last_used_weight = int(used_weight)
                except (ValueError, TypeError):
                    pass
                logger.debug(f"[BINANCE] {method} {endpoint} - Weight: {used_weight}/{self._weight_cap}")

                if response.status_code != 200:
                    try:
                        error_data = response.json() if response.text else {}
                    except ValueError:
                        error_data = {}

                    error_code = error_data.get("code", response.status_code)
                    error_msg = error_data.get("msg", response.text)

                    if signed and attempt == 0 and self._is_timestamp_error(error_code, error_msg):
                        logger.warning(
                            "[BINANCE] Timestamp drift detected for %s %s, syncing server time and retrying once",
                            method,
                            endpoint,
                        )
                        self._server_time_synced_at = 0.0
                        continue

                    logger.error(f"[BINANCE] API Error: {error_code} - {error_msg}")
                    raise Exception(f"Binance API Error {error_code}: {error_msg}")

                return response.json()

            except requests.exceptions.RequestException as e:
                logger.error(f"[BINANCE] Request failed: {endpoint} - {e}")
                raise

        raise RuntimeError(f"Binance request retry loop exited unexpectedly: {method} {endpoint}")

    def _get_exchange_info(self) -> Dict[str, Any]:
        """
        Get exchange info with caching.

        Returns:
            Exchange info dict with symbols and filters
        """
        now = time.time()
        if self._exchange_info_cache and (now - self._exchange_info_timestamp) < self._cache_ttl:
            return self._exchange_info_cache

        self._exchange_info_cache = self._request("GET", "/fapi/v1/exchangeInfo")
        self._exchange_info_timestamp = now
        return self._exchange_info_cache

    def _get_symbol_info(self, symbol: str) -> Optional[Dict[str, Any]]:
        """
        Get symbol-specific info including precision filters.

        Args:
            symbol: Trading pair symbol (e.g., 'BTCUSDT')

        Returns:
            Symbol info dict or None if not found
        """
        exchange_info = self._get_exchange_info()
        for sym_info in exchange_info.get("symbols", []):
            if sym_info["symbol"] == symbol:
                return sym_info
        return None

    def _get_precision(self, symbol: str) -> Dict[str, Any]:
        """
        Get price and quantity precision for a symbol.

        Args:
            symbol: Trading pair symbol (e.g., 'BTCUSDT')

        Returns:
            Dict with tick_size, step_size, min_qty, min_notional
        """
        sym_info = self._get_symbol_info(symbol)
        if not sym_info:
            # Default conservative values
            return {
                "tick_size": Decimal("0.01"),
                "step_size": Decimal("0.001"),
                "min_qty": Decimal("0.001"),
                "min_notional": Decimal("5")
            }

        result = {
            "tick_size": Decimal("0.01"),
            "step_size": Decimal("0.001"),
            "min_qty": Decimal("0.001"),
            "min_notional": Decimal("5")
        }

        for f in sym_info.get("filters", []):
            if f["filterType"] == "PRICE_FILTER":
                result["tick_size"] = Decimal(f["tickSize"])
            elif f["filterType"] == "LOT_SIZE":
                result["step_size"] = Decimal(f["stepSize"])
                result["min_qty"] = Decimal(f["minQty"])
            elif f["filterType"] == "MIN_NOTIONAL":
                result["min_notional"] = Decimal(f["notional"])

        return result

    def _round_price(self, price: float, tick_size: Decimal) -> Decimal:
        """Round price to tick size."""
        price_dec = Decimal(str(price))
        return (price_dec / tick_size).quantize(Decimal("1"), rounding=ROUND_DOWN) * tick_size

    def _round_quantity(self, quantity: float, step_size: Decimal) -> Decimal:
        """Round quantity to step size."""
        qty_dec = Decimal(str(quantity))
        return (qty_dec / step_size).quantize(Decimal("1"), rounding=ROUND_DOWN) * step_size

    def _to_binance_symbol(self, symbol: str) -> str:
        """
        Convert internal symbol to Binance format.

        Args:
            symbol: Internal symbol (e.g., 'BTC' or 'BTCUSDT')

        Returns:
            Binance symbol (e.g., 'BTCUSDT')
        """
        symbol = symbol.upper()
        if not symbol.endswith("USDT"):
            symbol = f"{symbol}USDT"
        return symbol

    def _to_internal_symbol(self, binance_symbol: str) -> str:
        """
        Convert Binance symbol to internal format.

        Args:
            binance_symbol: Binance symbol (e.g., 'BTCUSDT')

        Returns:
            Internal symbol (e.g., 'BTC')
        """
        if binance_symbol.endswith("USDT"):
            return binance_symbol[:-4]
        return binance_symbol

    # ==================== Account Methods ====================

    def get_ticker(self, symbol: str) -> Dict[str, Any]:
        """
        Get current price ticker for a symbol.

        Args:
            symbol: Trading pair (e.g., 'BTC')

        Returns:
            Dict with price info:
            - symbol: Trading pair
            - price: Current price
        """
        binance_symbol = self._to_binance_symbol(symbol)
        result = self._request("GET", "/fapi/v1/ticker/price", {"symbol": binance_symbol})
        return {
            "symbol": symbol,
            "price": float(result.get("price", 0)),
            "binance_symbol": binance_symbol
        }

    def get_account(self) -> Dict[str, Any]:
        """
        Get full account information including balances and positions.

        Returns:
            Account info dict with assets and positions arrays
        """
        return self._request("GET", "/fapi/v3/account", signed=True)

    def get_balance(self) -> Dict[str, Any]:
        """
        Get account balance summary.

        Returns:
            Dict with balance fields mapped to unified format:
            - total_equity: Total wallet balance + unrealized PnL
            - available_balance: Available for trading
            - used_margin: Total initial margin
            - maintenance_margin: Total maintenance margin
            - unrealized_pnl: Total unrealized profit
            - margin_usage_percent: Margin usage percentage
        """
        account = self.get_account()

        total_equity = float(account.get("totalMarginBalance", 0))
        used_margin = float(account.get("totalInitialMargin", 0))
        margin_usage_percent = (used_margin / total_equity * 100) if total_equity > 0 else 0.0

        return {
            "environment": self.environment,
            "total_equity": total_equity,
            "available_balance": float(account.get("availableBalance", 0)),
            "used_margin": used_margin,
            "maintenance_margin": float(account.get("totalMaintMargin", 0)),
            "unrealized_pnl": float(account.get("totalUnrealizedProfit", 0)),
            "total_wallet_balance": float(account.get("totalWalletBalance", 0)),
            "margin_usage_percent": round(margin_usage_percent, 1),
            "timestamp": self._get_timestamp(),
            "source": "live"
        }

    def get_positions(self, db=None, include_timing: bool = False) -> List[Dict[str, Any]]:
        """
        Get all open positions with unified field format (compatible with Hyperliquid).

        Uses /fapi/v3/positionRisk endpoint which provides complete position data
        including entryPrice, markPrice, and liquidationPrice.

        Args:
            db: Database session (unused, for Hyperliquid API compatibility)
            include_timing: Include position timing info (unused, for compatibility)

        Returns:
            List of position dicts with unified format matching Hyperliquid:
            - coin: Symbol without suffix (e.g., "BTC")
            - szi: Signed size (positive=long, negative=short)
            - entry_px: Average entry price
            - position_value: Notional value
            - unrealized_pnl: Position PnL
            - leverage: Position leverage (calculated from notional/margin)
            - liquidation_px: Estimated liquidation price
            - margin_used: Initial margin
            - leverage_type: "cross" or "isolated"
        """
        # Use positionRisk endpoint for complete position data
        position_risk = self._request("GET", "/fapi/v3/positionRisk", signed=True)
        positions = []
        user_fills: List[Dict[str, Any]] = []

        if include_timing:
            try:
                user_fills = self.get_user_fills(limit=1000)
            except Exception as e:
                logger.warning(f"[BINANCE] Failed to get user fills for position timing: {e}")

        # Build max leverage map from leverageBracket API (one call for all symbols)
        max_leverage_map = {}
        open_positions = [p for p in position_risk if float(p.get("positionAmt", 0)) != 0]
        if open_positions:
            try:
                brackets = self._request("GET", "/fapi/v1/leverageBracket", signed=True)
                for item in brackets:
                    symbol = item.get("symbol", "")
                    bracket_list = item.get("brackets", [])
                    if bracket_list:
                        # First bracket has the highest allowed leverage
                        max_lev = bracket_list[0].get("initialLeverage", 0)
                        # Store with USDT suffix removed
                        clean_symbol = symbol[:-4] if symbol.endswith("USDT") else symbol
                        max_leverage_map[clean_symbol] = max_lev
            except Exception as e:
                logger.warning(f"[BINANCE] Failed to fetch leverage brackets: {e}")

        for pos in position_risk:
            position_amt = float(pos.get("positionAmt", 0))
            if position_amt == 0:
                continue  # Skip empty positions

            symbol = pos.get("symbol", "")
            # Remove USDT suffix for internal format
            if symbol.endswith("USDT"):
                symbol = symbol[:-4]

            entry_price = float(pos.get("entryPrice", 0))
            notional = abs(float(pos.get("notional", 0)))
            initial_margin = float(pos.get("initialMargin", 0))

            # Calculate leverage from notional / initialMargin
            leverage = 1
            if initial_margin > 0:
                leverage = round(notional / initial_margin)

            # Determine margin type from isolatedMargin field
            isolated_margin = float(pos.get("isolatedMargin", 0))
            leverage_type = "isolated" if isolated_margin > 0 else "cross"

            # Determine side from position amount (positive=Long, negative=Short)
            side = "Long" if position_amt > 0 else "Short"

            opened_at = None
            opened_at_str = None
            holding_duration_seconds = None
            holding_duration_str = None

            if include_timing and user_fills and symbol:
                opened_at = self._calculate_position_opened_time(symbol, position_amt, user_fills)
                if opened_at:
                    utc_dt = datetime.utcfromtimestamp(opened_at / 1000)
                    opened_at_str = utc_dt.strftime('%Y-%m-%d %H:%M:%S UTC')

                    current_time_ms = self._get_timestamp()
                    holding_duration_seconds = (current_time_ms - opened_at) / 1000
                    hours = int(holding_duration_seconds // 3600)
                    minutes = int((holding_duration_seconds % 3600) // 60)
                    if hours > 0:
                        holding_duration_str = f"{hours}h {minutes}m"
                    else:
                        holding_duration_str = f"{minutes}m"

            positions.append({
                # Unified fields (Hyperliquid-compatible)
                "coin": symbol,
                "szi": position_amt,
                "entry_px": entry_price,
                "position_value": notional,
                "unrealized_pnl": float(pos.get("unRealizedProfit", 0)),
                "leverage": leverage,
                "liquidation_px": float(pos.get("liquidationPrice", 0)),
                "margin_used": initial_margin,
                "leverage_type": leverage_type,
                "side": side,  # Added: position direction for compatibility
                # Additional Binance-specific fields (for reference)
                "symbol": symbol,  # Alias for coin
                "mark_price": float(pos.get("markPrice", 0)),
                "maint_margin": float(pos.get("maintMargin", 0)),
                "position_side": pos.get("positionSide", "BOTH"),
                "max_leverage": max_leverage_map.get(symbol, 0),
                "opened_at": opened_at,
                "opened_at_str": opened_at_str,
                "holding_duration_seconds": holding_duration_seconds,
                "holding_duration_str": holding_duration_str,
            })

        return positions

    def _calculate_position_opened_time(
        self,
        symbol: str,
        current_position_size: float,
        fills: List[Dict[str, Any]]
    ) -> Optional[int]:
        """
        Calculate when the current position was opened based on user fills.

        Mirrors Hyperliquid's timing logic so Program Trader gets the same
        timing semantics across exchanges.
        """
        if not fills or abs(current_position_size) < 1e-8:
            return None

        symbol_fills = [f for f in fills if f.get("coin") == symbol]
        symbol_fills.sort(key=lambda x: x.get("time", 0), reverse=True)

        if not symbol_fills:
            return None

        position_tracker = current_position_size
        earliest_time = None

        for fill in symbol_fills:
            sz = float(fill.get("sz", 0) or 0)
            side = fill.get("side", "")

            if side == "B":
                position_before = position_tracker - sz
            elif side == "A":
                position_before = position_tracker + sz
            else:
                continue

            if abs(position_before) < 1e-8:
                earliest_time = fill.get("time")
                break
            elif (position_tracker > 0 and position_before < 0) or (position_tracker < 0 and position_before > 0):
                earliest_time = fill.get("time")
                break
            else:
                earliest_time = fill.get("time")
                position_tracker = position_before

        return earliest_time

    # ==================== Leverage Methods ====================

    def set_leverage(self, symbol: str, leverage: int) -> Dict[str, Any]:
        """
        Set leverage for a symbol.

        Args:
            symbol: Trading pair (e.g., 'BTC' or 'BTCUSDT')
            leverage: Target leverage (1-125, depends on symbol)

        Returns:
            Dict with leverage and maxNotionalValue
        """
        binance_symbol = self._to_binance_symbol(symbol)
        params = {
            "symbol": binance_symbol,
            "leverage": leverage
        }

        result = self._request("POST", "/fapi/v1/leverage", params, signed=True)
        logger.info(f"[BINANCE] Set leverage for {binance_symbol}: {leverage}x")
        return result

    # ==================== Order Methods ====================

    def place_order(
        self,
        symbol: str,
        side: str,
        quantity: float,
        order_type: str = "MARKET",
        price: Optional[float] = None,
        time_in_force: str = "GTC",
        reduce_only: bool = False,
        leverage: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Place an order on Binance Futures.

        Args:
            symbol: Trading pair (e.g., 'BTC')
            side: 'BUY' or 'SELL'
            quantity: Order quantity
            order_type: 'MARKET' or 'LIMIT'
            price: Limit price (required for LIMIT orders)
            time_in_force: 'GTC', 'IOC', 'FOK', 'GTX'
            reduce_only: Only reduce position
            leverage: Set leverage before order (optional)

        Returns:
            Order result dict with orderId, status, etc.
        """
        binance_symbol = self._to_binance_symbol(symbol)

        # Set leverage if specified (skip for close/reduce_only orders)
        if leverage and not reduce_only:
            self.set_leverage(symbol, leverage)

        # Get precision for rounding
        precision = self._get_precision(binance_symbol)
        rounded_qty = self._round_quantity(quantity, precision["step_size"])

        # Validate minimum quantity
        if rounded_qty < precision["min_qty"]:
            raise ValueError(
                f"Quantity {rounded_qty} below minimum {precision['min_qty']} for {binance_symbol}"
            )

        # Build order params
        params = {
            "symbol": binance_symbol,
            "side": side.upper(),
            "type": order_type.upper(),
            "quantity": str(rounded_qty),
            # Add broker ID prefix for commission tracking
            "newClientOrderId": f"x-{self.broker_id}-{self._get_timestamp()}"
        }

        if reduce_only:
            params["reduceOnly"] = "true"

        if order_type.upper() == "LIMIT":
            if price is None:
                raise ValueError("Price required for LIMIT orders")
            rounded_price = self._round_price(price, precision["tick_size"])
            params["price"] = str(rounded_price)
            params["timeInForce"] = time_in_force

        try:
            result = self._request("POST", "/fapi/v1/order", params, signed=True)
        except Exception as e:
            error_str = str(e)
            if "-4061" in error_str:
                raise Exception(
                    "Position mode mismatch: Your Binance account uses Hedge Mode (dual position). "
                    "Please switch to One-way Mode: Binance App → Futures → Settings → Position Mode → One-way Mode"
                )
            raise

        logger.info(
            f"[BINANCE] Order placed: {side} {rounded_qty} {binance_symbol} "
            f"@ {order_type} - Status: {result.get('status')}"
        )

        return {
            "order_id": result.get("orderId"),
            "client_order_id": result.get("clientOrderId"),
            "symbol": symbol,
            "side": side,
            "type": order_type,
            "quantity": float(rounded_qty),
            "price": float(result.get("price", 0)),
            "avg_price": float(result.get("avgPrice", 0)),
            "executed_qty": float(result.get("executedQty", 0)),
            "status": result.get("status"),
            "time_in_force": result.get("timeInForce"),
            "reduce_only": result.get("reduceOnly", False),
            "environment": self.environment,
            "raw_response": result
        }

    def place_stop_order(
        self,
        symbol: str,
        side: str,
        quantity: float,
        stop_price: float,
        order_type: str = "STOP_MARKET",
        reduce_only: bool = True,
        working_type: str = "MARK_PRICE",
        client_algo_id: Optional[str] = None,
        price: Optional[float] = None
    ) -> Dict[str, Any]:
        """
        Place a stop-loss or take-profit order using Algo Order API.

        Since 2025-12-09, Binance migrated conditional orders to Algo Service.
        This method uses /fapi/v1/algoOrder endpoint.

        Args:
            symbol: Trading pair (e.g., 'BTC')
            side: 'BUY' or 'SELL'
            quantity: Order quantity
            stop_price: Trigger price
            order_type: 'STOP_MARKET', 'TAKE_PROFIT_MARKET', 'STOP', or 'TAKE_PROFIT'
            reduce_only: Only reduce position (default True for SL/TP)
            working_type: 'MARK_PRICE' or 'CONTRACT_PRICE'
            client_algo_id: Custom ID for order association (e.g., 'TP_123' or 'SL_123')
            price: Limit price for STOP/TAKE_PROFIT orders (required for limit types)

        Returns:
            Order result dict with algo_id for tracking
        """
        binance_symbol = self._to_binance_symbol(symbol)
        precision = self._get_precision(binance_symbol)

        rounded_qty = self._round_quantity(quantity, precision["step_size"])
        rounded_stop = self._round_price(stop_price, precision["tick_size"])

        params = {
            "symbol": binance_symbol,
            "side": side.upper(),
            "type": order_type.upper(),
            "algoType": "CONDITIONAL",
            "quantity": str(rounded_qty),
            "triggerPrice": str(rounded_stop),
            "workingType": working_type,
            "timeInForce": "GTE_GTC",
        }

        # For limit-type orders (STOP, TAKE_PROFIT), price is required
        # Default to trigger price if not specified (方案B: price = triggerPrice)
        if order_type.upper() in ("STOP", "TAKE_PROFIT"):
            limit_price = price if price else stop_price
            rounded_price = self._round_price(limit_price, precision["tick_size"])
            params["price"] = str(rounded_price)

        if client_algo_id:
            params["clientAlgoId"] = client_algo_id

        if reduce_only:
            params["reduceOnly"] = "true"

        result = self._request("POST", "/fapi/v1/algoOrder", params, signed=True)

        logger.info(
            f"[BINANCE] Algo order placed: {order_type} {side} {rounded_qty} "
            f"{binance_symbol} trigger@{rounded_stop} algoId={result.get('algoId')}"
        )

        return {
            "algo_id": result.get("algoId"),
            "client_algo_id": result.get("clientAlgoId"),
            "symbol": symbol,
            "side": side,
            "type": order_type,
            "quantity": float(rounded_qty),
            "trigger_price": float(rounded_stop),
            "status": result.get("algoStatus"),
            "working_type": working_type,
            "reduce_only": reduce_only,
            "environment": self.environment,
            "raw_response": result
        }

    def cancel_order(
        self,
        symbol: str,
        order_id: Optional[int] = None,
        client_order_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Cancel an open order.

        Args:
            symbol: Trading pair
            order_id: Binance order ID
            client_order_id: Client order ID (alternative to order_id)

        Returns:
            Cancelled order info
        """
        binance_symbol = self._to_binance_symbol(symbol)
        params = {"symbol": binance_symbol}

        if order_id:
            params["orderId"] = order_id
        elif client_order_id:
            params["origClientOrderId"] = client_order_id
        else:
            raise ValueError("Either order_id or client_order_id required")

        result = self._request("DELETE", "/fapi/v1/order", params, signed=True)
        logger.info(f"[BINANCE] Order cancelled: {order_id or client_order_id}")
        return result

    def cancel_all_orders(self, symbol: str) -> Dict[str, Any]:
        """Cancel all open orders for a symbol."""
        binance_symbol = self._to_binance_symbol(symbol)
        result = self._request(
            "DELETE", "/fapi/v1/allOpenOrders",
            {"symbol": binance_symbol}, signed=True
        )
        logger.info(f"[BINANCE] All orders cancelled for {binance_symbol}")
        return result

    def get_open_algo_orders(self, symbol: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Get all open Algo orders (TP/SL conditional orders).

        Args:
            symbol: Optional symbol filter

        Returns:
            List of open algo orders
        """
        params = {}
        if symbol:
            params["symbol"] = self._to_binance_symbol(symbol)

        result = self._request("GET", "/fapi/v1/openAlgoOrders", params, signed=True)
        return result.get("orders", []) if isinstance(result, dict) else result

    def cancel_algo_order(self, symbol: str, algo_id: int) -> Dict[str, Any]:
        """
        Cancel a specific Algo order.

        Args:
            symbol: Trading pair
            algo_id: Algo order ID

        Returns:
            Cancellation result
        """
        binance_symbol = self._to_binance_symbol(symbol)
        params = {
            "symbol": binance_symbol,
            "algoId": algo_id
        }
        result = self._request("DELETE", "/fapi/v1/algoOrder", params, signed=True)
        logger.info(f"[BINANCE] Algo order {algo_id} cancelled for {binance_symbol}")
        return result

    def cancel_all_algo_orders(self, symbol: str) -> Dict[str, Any]:
        """
        Cancel all open Algo orders (TP/SL) for a symbol.

        Args:
            symbol: Trading pair

        Returns:
            Dict with cancelled count and details
        """
        binance_symbol = self._to_binance_symbol(symbol)
        algo_orders = self.get_open_algo_orders(symbol)

        cancelled = []
        errors = []

        for order in algo_orders:
            algo_id = order.get("algoId")
            if algo_id:
                try:
                    self.cancel_algo_order(symbol, algo_id)
                    cancelled.append(algo_id)
                except Exception as e:
                    logger.warning(f"[BINANCE] Failed to cancel algo order {algo_id}: {e}")
                    errors.append({"algo_id": algo_id, "error": str(e)})

        logger.info(f"[BINANCE] Cancelled {len(cancelled)} algo orders for {binance_symbol}")
        return {
            "symbol": symbol,
            "cancelled_count": len(cancelled),
            "cancelled_ids": cancelled,
            "errors": errors
        }

    def get_open_orders(self, db=None, symbol: Optional[str] = None) -> List[Dict[str, Any]]:
        """Get all open orders including Algo orders (TP/SL), optionally filtered by symbol.

        Args:
            db: Database session (unused, for Hyperliquid API compatibility)
            symbol: Optional symbol to filter orders

        Returns:
            List of order dicts with unified format matching Hyperliquid:
            - order_id, symbol, side, direction, order_type, size, price
            - trigger_price, reduce_only, is_trigger, trigger_condition
        """
        params = {}
        if symbol:
            params["symbol"] = self._to_binance_symbol(symbol)

        # Get regular orders
        regular_orders = self._request("GET", "/fapi/v1/openOrders", params, signed=True)

        # Get algo orders (TP/SL)
        algo_result = self._request("GET", "/fapi/v1/openAlgoOrders", params, signed=True)
        algo_orders = algo_result.get("orders", []) if isinstance(algo_result, dict) else algo_result

        # Convert to unified format
        orders = []

        # Process regular orders
        for o in regular_orders:
            sym = o.get("symbol", "")
            if sym.endswith("USDT"):
                sym = sym[:-4]
            side_raw = o.get("side", "").upper()
            reduce_only = o.get("reduceOnly", False)
            side = "Buy" if side_raw == "BUY" else "Sell"
            if side == "Buy":
                direction = "Close Short" if reduce_only else "Open Long"
            else:
                direction = "Close Long" if reduce_only else "Open Short"

            orders.append({
                "order_id": o.get("orderId"),
                "symbol": sym,
                "side": side,
                "direction": direction,
                "order_type": o.get("type", "LIMIT"),
                "size": float(o.get("origQty", 0)),
                "price": float(o.get("price", 0)),
                "trigger_price": float(o.get("stopPrice", 0)) if o.get("stopPrice") else None,
                "reduce_only": reduce_only,
                "is_trigger": o.get("type", "").startswith("STOP") or o.get("type", "").startswith("TAKE"),
                "trigger_condition": None,
                "timestamp": o.get("time", 0),
            })

        # Process algo orders (TP/SL)
        for o in algo_orders:
            sym = o.get("symbol", "")
            if sym.endswith("USDT"):
                sym = sym[:-4]
            side_raw = o.get("side", "").upper()
            side = "Buy" if side_raw == "BUY" else "Sell"
            reduce_only = o.get("reduceOnly", False)
            # Determine direction: Buy+reduceOnly=Close Short (buying to close short position)
            # Sell+reduceOnly=Close Long (selling to close long position)
            if side == "Buy":
                direction = "Close Short" if reduce_only else "Open Long"
            else:
                direction = "Close Long" if reduce_only else "Open Short"

            # Determine order type from orderType field (TAKE_PROFIT/STOP)
            order_type_raw = o.get("orderType", "")
            if order_type_raw == "TAKE_PROFIT":
                order_type = "Take Profit"
            elif order_type_raw == "STOP":
                order_type = "Stop Loss"
            else:
                order_type = order_type_raw or o.get("algoType", "CONDITIONAL")

            trigger_price = float(o.get("triggerPrice", 0)) if o.get("triggerPrice") else None
            # TP triggers when price reaches target (<=), SL triggers when price hits stop (>=)
            if trigger_price:
                if order_type_raw == "TAKE_PROFIT":
                    trigger_cond = f"Mark Price <= {trigger_price}"
                else:
                    trigger_cond = f"Mark Price >= {trigger_price}"
            else:
                trigger_cond = None

            orders.append({
                "order_id": o.get("algoId"),
                "symbol": sym,
                "side": side,
                "direction": direction,
                "order_type": order_type,
                "size": float(o.get("quantity", 0)),  # Algo orders use 'quantity' not 'origQty'
                "price": float(o.get("price", 0)),
                "trigger_price": trigger_price,
                "reduce_only": reduce_only,
                "is_trigger": True,
                "trigger_condition": trigger_cond,
                "timestamp": o.get("createTime", 0),  # Algo orders use 'createTime'
            })

        return orders

    def get_order(
        self,
        symbol: str,
        order_id: Optional[int] = None,
        client_order_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """Query a specific order by ID."""
        binance_symbol = self._to_binance_symbol(symbol)
        params = {"symbol": binance_symbol}

        if order_id:
            params["orderId"] = order_id
        elif client_order_id:
            params["origClientOrderId"] = client_order_id
        else:
            raise ValueError("Either order_id or client_order_id required")

        return self._request("GET", "/fapi/v1/order", params, signed=True)

    def get_mark_price(self, symbol: str) -> float:
        """Get current mark price for a symbol."""
        binance_symbol = self._to_binance_symbol(symbol)
        result = self._request("GET", "/fapi/v1/premiumIndex", {"symbol": binance_symbol})
        return float(result.get("markPrice", 0))

    def close_position(self, symbol: str, cancel_tpsl: bool = True) -> Optional[Dict[str, Any]]:
        """
        Close entire position for a symbol using market order.

        Args:
            symbol: Trading pair symbol
            cancel_tpsl: If True, also cancel associated TP/SL algo orders

        Returns:
            Order result if position exists, None if no position
        """
        positions = self.get_positions()
        position = next((p for p in positions if p["symbol"] == symbol.upper()), None)

        if not position or position["szi"] == 0:
            logger.info(f"[BINANCE] No position to close for {symbol}")
            return None

        # Determine side to close
        size = abs(position["szi"])
        side = "SELL" if position["szi"] > 0 else "BUY"

        # Place market order to close position
        result = self.place_order(
            symbol=symbol,
            side=side,
            quantity=size,
            order_type="MARKET",
            reduce_only=True
        )

        # Cancel associated TP/SL algo orders
        if cancel_tpsl:
            try:
                algo_result = self.cancel_all_algo_orders(symbol)
                result["cancelled_algo_orders"] = algo_result
                logger.info(f"[BINANCE] Closed position and cancelled {algo_result['cancelled_count']} TP/SL orders for {symbol}")
            except Exception as e:
                logger.warning(f"[BINANCE] Position closed but failed to cancel TP/SL: {e}")
                result["cancelled_algo_orders"] = {"error": str(e)}

        return result

    def place_order_with_tpsl(
        self,
        db,
        symbol: str,
        is_buy: bool,
        size: float,
        price: float,
        leverage: int = 1,
        time_in_force: str = "GTC",
        reduce_only: bool = False,
        take_profit_price: Optional[float] = None,
        stop_loss_price: Optional[float] = None,
        order_type: str = "MARKET",
        tp_execution: str = "market",  # Ignored for Binance (always market)
        sl_execution: str = "market",  # Ignored for Binance (always market)
    ) -> Dict[str, Any]:
        """
        Place order with take profit and stop loss (unified interface matching Hyperliquid).

        Args:
            db: Database session (for compatibility, not used in Binance)
            symbol: Asset symbol (e.g., "BTC")
            is_buy: True for long, False for short
            size: Order quantity
            price: Order price (used for LIMIT orders, ignored for MARKET)
            leverage: Position leverage
            time_in_force: Order time in force - "GTC", "IOC", "FOK", "GTX" or Hyperliquid style "Ioc", "Gtc"
            reduce_only: Only close existing positions
            take_profit_price: Optional take profit trigger price
            stop_loss_price: Optional stop loss trigger price
            order_type: "MARKET" or "LIMIT"
            tp_execution: Ignored for Binance (always uses TAKE_PROFIT_MARKET)
            sl_execution: Ignored for Binance (always uses STOP_MARKET)

        Returns:
            Dict with order results including TP/SL order IDs
        """
        # Normalize time_in_force from Hyperliquid style to Binance style
        tif_mapping = {"ioc": "IOC", "gtc": "GTC", "alo": "GTX"}
        time_in_force = tif_mapping.get(time_in_force.lower(), time_in_force.upper())

        # Validate parameters
        if leverage < 1:
            raise ValueError(f"Invalid leverage: {leverage}. Must be >= 1")
        if size <= 0:
            raise ValueError(f"Invalid size: {size}. Must be positive")
        if price <= 0 and order_type.upper() == "LIMIT":
            raise ValueError(f"Invalid price: {price}. Must be positive for LIMIT orders")

        # Validate time_in_force
        valid_tif = ["GTC", "IOC", "FOK", "GTX"]
        if time_in_force.upper() not in valid_tif:
            raise ValueError(f"Invalid time_in_force: {time_in_force}. Must be one of {valid_tif}")

        side = "BUY" if is_buy else "SELL"

        logger.info(
            f"[BINANCE] Placing order on {self.environment.upper()}: "
            f"{symbol} {side} size={size} price={price} "
            f"leverage={leverage}x TIF={time_in_force} TP={take_profit_price} SL={stop_loss_price}"
        )

        result = {
            "status": "error",
            "order_id": None,
            "tp_order_id": None,
            "sl_order_id": None,
            "filled_qty": 0.0,
            "avg_price": 0.0,
            "environment": self.environment,
            "errors": []
        }

        try:
            # Place main order
            main_result = self.place_order(
                symbol=symbol,
                side=side,
                quantity=size,
                order_type=order_type,
                price=price if order_type.upper() == "LIMIT" else None,
                time_in_force=time_in_force if order_type.upper() == "LIMIT" else "GTC",
                reduce_only=reduce_only,
                leverage=leverage
            )

            main_order_id = main_result.get("order_id")
            main_status = main_result.get("status")
            executed_qty = main_result.get("executed_qty", 0) or size

            result["order_id"] = main_order_id
            result["filled_qty"] = float(main_result.get("executed_qty", 0))
            result["avg_price"] = float(main_result.get("avg_price", 0))
            result["raw_main_order"] = main_result

            # Check if main order succeeded
            if main_status in ("FILLED", "NEW", "PARTIALLY_FILLED"):
                result["status"] = "filled" if main_status == "FILLED" else "resting"
                logger.info(f"[BINANCE] Main order succeeded: {main_order_id} status={main_status}")

                # Place TP/SL orders if main order succeeded and not reduce_only
                if not reduce_only:
                    close_side = "SELL" if is_buy else "BUY"

                    # Place Take Profit order
                    # tp_execution: "market" -> TAKE_PROFIT_MARKET, "limit" -> TAKE_PROFIT
                    if take_profit_price and take_profit_price > 0:
                        try:
                            tp_order_type = "TAKE_PROFIT" if tp_execution == "limit" else "TAKE_PROFIT_MARKET"
                            tp_result = self.place_stop_order(
                                symbol=symbol,
                                side=close_side,
                                quantity=executed_qty,
                                stop_price=take_profit_price,
                                order_type=tp_order_type,
                                reduce_only=True,
                                client_algo_id=f"TP_{main_order_id}" if main_order_id else None
                            )
                            result["tp_order_id"] = tp_result.get("algo_id")
                            result["raw_tp_order"] = tp_result
                            logger.info(f"[BINANCE] TP order placed: algo_id={result['tp_order_id']} type={tp_order_type}")
                        except Exception as tp_err:
                            logger.error(f"[BINANCE] Failed to place TP order: {tp_err}")
                            result["errors"].append(f"TP order failed: {str(tp_err)}")

                    # Place Stop Loss order
                    # sl_execution: "market" -> STOP_MARKET, "limit" -> STOP
                    if stop_loss_price and stop_loss_price > 0:
                        try:
                            sl_order_type = "STOP" if sl_execution == "limit" else "STOP_MARKET"
                            sl_result = self.place_stop_order(
                                symbol=symbol,
                                side=close_side,
                                quantity=executed_qty,
                                stop_price=stop_loss_price,
                                order_type=sl_order_type,
                                reduce_only=True,
                                client_algo_id=f"SL_{main_order_id}" if main_order_id else None
                            )
                            result["sl_order_id"] = sl_result.get("algo_id")
                            result["raw_sl_order"] = sl_result
                            logger.info(f"[BINANCE] SL order placed: algo_id={result['sl_order_id']} type={sl_order_type}")
                        except Exception as sl_err:
                            logger.error(f"[BINANCE] Failed to place SL order: {sl_err}")
                            result["errors"].append(f"SL order failed: {str(sl_err)}")
            else:
                result["status"] = "error"
                result["error"] = f"Main order failed with status: {main_status}"
                logger.warning(f"[BINANCE] Main order failed: {main_result}")

        except Exception as e:
            result["status"] = "error"
            result["error"] = str(e)
            logger.error(f"[BINANCE] place_order_with_tpsl failed: {e}", exc_info=True)

        return result

    def get_account_state(self, db=None) -> Dict[str, Any]:
        """
        Get account state in unified format (compatible with HyperliquidTradingClient).

        Returns:
            Dict with: available_balance, total_equity, used_margin,
                      margin_usage_percent, maintenance_margin
        """
        balance = self.get_balance()
        return {
            "available_balance": balance.get("available_balance", 0.0),
            "total_equity": balance.get("total_equity", 0.0),
            "used_margin": balance.get("used_margin", 0.0),
            "margin_usage_percent": balance.get("margin_usage_percent", 0.0),
            "maintenance_margin": balance.get("maintenance_margin", 0.0),
        }

    def get_rate_limit(self) -> Dict[str, Any]:
        """
        Get current API rate limit info from last request's response header.

        Returns:
            Dict with: used_weight, weight_cap, remaining, usage_percent
        """
        remaining = self._weight_cap - self._last_used_weight
        usage_percent = (self._last_used_weight / self._weight_cap * 100) if self._weight_cap > 0 else 0
        return {
            "used_weight": self._last_used_weight,
            "weight_cap": self._weight_cap,
            "remaining": remaining,
            "usage_percent": round(usage_percent, 1),
        }

    def get_open_orders_formatted(self, db=None, symbol: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Get open orders in unified format (compatible with HyperliquidTradingClient).

        Returns list of dicts with fields:
            order_id, symbol, side, direction, order_type, size, price,
            order_value, reduce_only, trigger_condition, trigger_price, order_time

        Note: get_open_orders() now returns unified format including Algo orders (TP/SL),
        so this method simply delegates to it and adds order_value/order_time fields.
        """
        orders = self.get_open_orders(db, symbol)

        # Add order_value and order_time fields for compatibility
        for o in orders:
            price = float(o.get("price", 0))
            size = float(o.get("size", 0))
            o["order_value"] = price * size
            o["original_size"] = size
            # Convert timestamp to order_time string
            ts = o.get("timestamp", 0)
            o["order_time"] = datetime.fromtimestamp(ts / 1000).strftime("%Y-%m-%d %H:%M:%S") if ts else "N/A"

        return orders

    def get_recent_closed_trades(self, db=None, limit: int = 5) -> List[Dict[str, Any]]:
        """
        Get recent closed trades in unified format (compatible with HyperliquidTradingClient).

        Uses Binance's /fapi/v1/userTrades endpoint to get trade history,
        then filters for trades that closed positions (have realizedPnl != 0).

        Returns list of dicts with fields:
            symbol, side, close_time, close_price, realized_pnl, direction
        """
        # Get all trades from last 7 days (Binance default)
        params = {"limit": 1000}  # Get more to filter
        raw_trades = self._request("GET", "/fapi/v1/userTrades", params, signed=True)

        # Filter for trades with realized PnL (position closures)
        closed_trades = []
        for t in raw_trades:
            realized_pnl = float(t.get("realizedPnl", 0))
            if realized_pnl != 0:
                sym = self._to_internal_symbol(t.get("symbol", ""))
                side = t.get("side", "")
                trade_time_ms = t.get("time", 0)
                close_time = datetime.fromtimestamp(trade_time_ms / 1000).strftime("%Y-%m-%d %H:%M:%S") if trade_time_ms else "N/A"

                # Direction: if SELL with positive PnL = closed long, etc.
                if realized_pnl > 0:
                    direction = "WIN"
                else:
                    direction = "LOSS"

                closed_trades.append({
                    "symbol": sym,
                    "side": side,
                    "close_time": close_time,
                    "close_timestamp": trade_time_ms,
                    "close_price": float(t.get("price", 0)),
                    "realized_pnl": realized_pnl,
                    "direction": direction,
                    "size": float(t.get("qty", 0)),
                })

        # Sort by time (newest first) and limit
        closed_trades.sort(key=lambda x: x.get("close_timestamp", 0), reverse=True)
        return closed_trades[:limit]

    def get_income_history(
        self,
        income_type: Optional[str] = None,
        start_time: Optional[int] = None,
        end_time: Optional[int] = None,
        limit: int = 1000
    ) -> List[Dict[str, Any]]:
        """
        Get income history including realized PnL, funding fees, commissions.

        Args:
            income_type: Filter by type (REALIZED_PNL, FUNDING_FEE, COMMISSION, etc.)
            start_time: Start timestamp in ms
            end_time: End timestamp in ms
            limit: Max records (default 1000)

        Returns:
            List of income records
        """
        params = {"limit": limit}
        if income_type:
            params["incomeType"] = income_type
        if start_time:
            params["startTime"] = start_time
        if end_time:
            params["endTime"] = end_time

        return self._request("GET", "/fapi/v1/income", params, signed=True)

    def get_trading_stats(self, db=None) -> Dict[str, Any]:
        """
        Get trading statistics including win rate, profit factor, etc.

        Similar to Hyperliquid's get_trading_stats for consistency.

        Returns:
            Dict with trading statistics
        """
        try:
            # Get income history for realized PnL totals
            income_data = self.get_income_history(income_type="REALIZED_PNL")

            # Get user trades for win/loss calculation
            params = {"limit": 1000}
            raw_trades = self._request("GET", "/fapi/v1/userTrades", params, signed=True)

            # Filter trades with realized PnL (position closures)
            closed_fills = []
            for t in raw_trades:
                realized_pnl = float(t.get("realizedPnl", 0))
                if realized_pnl != 0:
                    closed_fills.append({
                        "pnl": realized_pnl,
                        "time": t.get("time", 0),
                        "symbol": self._to_internal_symbol(t.get("symbol", "")),
                    })

            # Calculate total PnL from income history
            total_pnl = sum(float(i.get("income", 0)) for i in income_data)

            # Calculate volume from trades
            volume = sum(
                float(t.get("qty", 0)) * float(t.get("price", 0))
                for t in raw_trades
            )

            if not closed_fills:
                return {
                    "total_trades": 0,
                    "wins": 0,
                    "losses": 0,
                    "win_rate": 0.0,
                    "total_pnl": round(total_pnl, 2),
                    "volume": round(volume, 2),
                    "avg_win": 0.0,
                    "avg_loss": 0.0,
                    "profit_factor": 0.0,
                    "gross_profit": 0.0,
                    "gross_loss": 0.0,
                }

            # Calculate win/loss statistics
            wins = [t for t in closed_fills if t["pnl"] > 0]
            losses = [t for t in closed_fills if t["pnl"] < 0]

            total_trades = len(closed_fills)
            win_count = len(wins)
            loss_count = len(losses)

            win_rate = (win_count / total_trades * 100) if total_trades > 0 else 0.0
            gross_profit = sum(t["pnl"] for t in wins) if wins else 0.0
            gross_loss = abs(sum(t["pnl"] for t in losses)) if losses else 0.0
            avg_win = gross_profit / win_count if win_count > 0 else 0.0
            avg_loss = -gross_loss / loss_count if loss_count > 0 else 0.0
            profit_factor = gross_profit / gross_loss if gross_loss > 0 else 0.0

            stats = {
                "total_trades": total_trades,
                "wins": win_count,
                "losses": loss_count,
                "win_rate": round(win_rate, 1),
                "total_pnl": round(total_pnl, 2),
                "volume": round(volume, 2),
                "avg_win": round(avg_win, 2),
                "avg_loss": round(avg_loss, 2),
                "profit_factor": round(profit_factor, 2),
                "gross_profit": round(gross_profit, 2),
                "gross_loss": round(gross_loss, 2),
            }

            logger.info(f"[BINANCE] Trading stats: {win_count}W/{loss_count}L, PNL=${total_pnl:.2f}")
            return stats

        except Exception as e:
            logger.error(f"[BINANCE] Failed to get trading stats: {e}", exc_info=True)
            return {
                "total_trades": 0,
                "wins": 0,
                "losses": 0,
                "win_rate": 0.0,
                "total_pnl": 0.0,
                "volume": 0.0,
                "avg_win": 0.0,
                "avg_loss": 0.0,
                "profit_factor": 0.0,
                "gross_profit": 0.0,
                "gross_loss": 0.0,
                "error": str(e),
            }

    def get_user_fills(self, limit: int = 1000) -> List[Dict[str, Any]]:
        """
        Get all user fills (trade executions) from Binance.

        Similar to Hyperliquid's _get_user_fills() for PnL sync.

        Returns:
            List of fill dicts with unified fields:
                - oid: Order ID (string)
                - coin: Symbol name (e.g., "BTC")
                - side: "B" (buy) or "A" (sell) - unified with Hyperliquid
                - px: Execution price
                - sz: Size filled
                - time: Execution timestamp (milliseconds)
                - closedPnl: Realized PnL
                - fee: Commission fee
                - main_order_id: For TP/SL orders, the main order ID they belong to
                - order_type: "tp", "sl", or "main"
        """
        params = {"limit": limit}
        raw_trades = self._request("GET", "/fapi/v1/userTrades", params, signed=True)

        # Get order info to map orderId -> clientOrderId for TP/SL detection
        # TP/SL orders triggered from Algo orders have clientOrderId like "TP_123" or "SL_123"
        order_info = {}
        try:
            all_orders = self._request("GET", "/fapi/v1/allOrders", {"limit": limit}, signed=True)
            for o in all_orders:
                order_info[str(o.get("orderId", ""))] = o.get("clientOrderId", "")
        except Exception as e:
            logger.warning(f"[BINANCE] Failed to get order info for TP/SL detection: {e}")

        fills = []
        for t in raw_trades:
            order_id = str(t.get("orderId", ""))
            client_order_id = order_info.get(order_id, "")

            # Detect TP/SL orders by clientOrderId pattern (e.g., "TP_12345" or "SL_12345")
            main_order_id = None
            order_type = "main"
            if client_order_id.startswith("TP_"):
                main_order_id = client_order_id[3:]  # Extract main order ID after "TP_"
                order_type = "tp"
            elif client_order_id.startswith("SL_"):
                main_order_id = client_order_id[3:]  # Extract main order ID after "SL_"
                order_type = "sl"

            # Convert Binance format to unified format (compatible with Hyperliquid)
            fills.append({
                "oid": order_id,
                "coin": self._to_internal_symbol(t.get("symbol", "")),
                "side": "B" if t.get("side") == "BUY" else "A",
                "px": str(t.get("price", "0")),
                "sz": str(t.get("qty", "0")),
                "time": t.get("time", 0),
                "closedPnl": str(t.get("realizedPnl", "0")),
                "fee": str(t.get("commission", "0")),
                "main_order_id": main_order_id,
                "order_type": order_type,
            })

        logger.info(f"[BINANCE] Retrieved {len(fills)} user fills")
        return fills

    def check_rebate_eligibility(self) -> Dict[str, Any]:
        """
        Check if the user is eligible for API broker rebate.

        Uses Binance API endpoint: GET /fapi/v1/apiReferral/ifNewUser

        Returns:
            Dict with:
                - eligible: True if both rebateWorking and ifNewUser are True
                - rebate_working: User has no prior referral and VIP < 3
                - is_new_user: User registered after broker joined program
                - raw_response: Original API response
        """
        try:
            # brokerId is required for this endpoint
            params = {"brokerId": self.broker_id} if self.broker_id else {}
            result = self._request("GET", "/fapi/v1/apiReferral/ifNewUser", params, signed=True)

            rebate_working = result.get("rebateWorking", False)
            is_new_user = result.get("ifNewUser", False)

            logger.info(
                f"[BINANCE] Rebate eligibility check: "
                f"rebateWorking={rebate_working}, ifNewUser={is_new_user}"
            )

            return {
                "eligible": rebate_working and is_new_user,
                "rebate_working": rebate_working,
                "is_new_user": is_new_user,
                "raw_response": result
            }
        except Exception as e:
            logger.error(f"[BINANCE] Failed to check rebate eligibility: {e}")
            # Return ineligible on error to be safe
            return {
                "eligible": False,
                "rebate_working": False,
                "is_new_user": False,
                "error": str(e)
            }
