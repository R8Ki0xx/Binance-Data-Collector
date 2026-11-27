"""
Base adapter interface for exchange integrations.

All exchange adapters must inherit from BaseExchangeAdapter and implement
the required methods for data fetching and format conversion.
"""

from abc import ABC, abstractmethod
from decimal import Decimal
from typing import Dict, List, Optional, Any
from dataclasses import dataclass
from datetime import datetime


@dataclass
class UnifiedKline:
    """Unified K-line data structure for all exchanges."""
    exchange: str
    symbol: str  # Internal format (e.g., "BTC")
    interval: str  # "1m", "5m", "15m", "30m", "1h", "4h", "1d"
    timestamp: int  # Unix timestamp in seconds
    open_price: Decimal
    high_price: Decimal
    low_price: Decimal
    close_price: Decimal
    volume: Decimal  # Base currency volume
    quote_volume: Decimal  # Quote currency volume (USDT/USDC)
    taker_buy_volume: Optional[Decimal] = None  # For CVD calculation
    taker_sell_volume: Optional[Decimal] = None
    taker_buy_notional: Optional[Decimal] = None  # Taker buy in quote currency (for CVD)
    taker_sell_notional: Optional[Decimal] = None  # Taker sell in quote currency
    trade_count: Optional[int] = None


@dataclass
class UnifiedTrade:
    """Unified trade data structure."""
    exchange: str
    symbol: str
    timestamp: int  # Milliseconds
    price: Decimal
    size: Decimal
    side: str  # "buy" or "sell" (taker side)
    trade_id: Optional[str] = None


@dataclass
class UnifiedOrderbook:
    """Unified orderbook snapshot structure."""
    exchange: str
    symbol: str
    timestamp: int  # Milliseconds
    best_bid: Decimal
    best_ask: Decimal
    bid_depth_sum: Decimal  # Sum of top N bid quantities
    ask_depth_sum: Decimal  # Sum of top N ask quantities
    spread: Decimal
    spread_bps: Decimal  # Spread in basis points


@dataclass
class UnifiedFunding:
    """Unified funding rate structure."""
    exchange: str
    symbol: str
    timestamp: int  # Milliseconds
    funding_rate: Decimal  # As decimal (e.g., 0.0001 = 0.01%)
    next_funding_time: Optional[int] = None
    mark_price: Optional[Decimal] = None


@dataclass
class UnifiedOpenInterest:
    """Unified open interest structure."""
    exchange: str
    symbol: str
    timestamp: int  # Milliseconds
    open_interest: Decimal  # In base currency
    open_interest_value: Optional[Decimal] = None  # In quote currency


@dataclass
class UnifiedSentiment:
    """Unified market sentiment structure (long/short ratio)."""
    exchange: str
    symbol: str
    timestamp: int  # Milliseconds
    long_ratio: Decimal  # e.g., 0.65 = 65% long
    short_ratio: Decimal  # e.g., 0.35 = 35% short
    long_short_ratio: Decimal  # e.g., 1.86 = longs/shorts


class BaseExchangeAdapter(ABC):
    """
    Abstract base class for exchange adapters.

    Each exchange adapter must implement these methods to provide
    unified data access across different exchanges.
    """

    def __init__(self, environment: str = "mainnet"):
        """
        Initialize the adapter.

        Args:
            environment: "mainnet" or "testnet"
        """
        self.environment = environment
        self.exchange_name = self._get_exchange_name()

    @abstractmethod
    def _get_exchange_name(self) -> str:
        """Return the exchange name (e.g., 'binance', 'hyperliquid')."""
        pass

    # ==================== Data Fetching Methods ====================

    @abstractmethod
    def fetch_klines(
        self,
        symbol: str,
        interval: str,
        limit: int = 100,
        start_time: Optional[int] = None,
        end_time: Optional[int] = None,
    ) -> List[UnifiedKline]:
        """
        Fetch K-line/candlestick data.

        Args:
            symbol: Internal symbol (e.g., "BTC")
            interval: Timeframe ("1m", "5m", "1h", etc.)
            limit: Number of candles to fetch
            start_time: Start timestamp in milliseconds (optional)
            end_time: End timestamp in milliseconds (optional)

        Returns:
            List of UnifiedKline objects
        """
        pass

    @abstractmethod
    def fetch_orderbook(
        self, symbol: str, depth: int = 10
    ) -> UnifiedOrderbook:
        """
        Fetch current orderbook snapshot.

        Args:
            symbol: Internal symbol
            depth: Number of price levels to fetch

        Returns:
            UnifiedOrderbook object
        """
        pass

    @abstractmethod
    def fetch_funding_rate(self, symbol: str) -> UnifiedFunding:
        """
        Fetch current funding rate.

        Args:
            symbol: Internal symbol

        Returns:
            UnifiedFunding object
        """
        pass

    @abstractmethod
    def fetch_open_interest(self, symbol: str) -> UnifiedOpenInterest:
        """
        Fetch current open interest.

        Args:
            symbol: Internal symbol

        Returns:
            UnifiedOpenInterest object
        """
        pass

    # ==================== Optional Methods ====================

    def fetch_sentiment(self, symbol: str) -> Optional[UnifiedSentiment]:
        """
        Fetch market sentiment (long/short ratio).
        Not all exchanges support this.

        Args:
            symbol: Internal symbol

        Returns:
            UnifiedSentiment object or None if not supported
        """
        return None

    def fetch_funding_history(
        self,
        symbol: str,
        limit: int = 100,
        start_time: Optional[int] = None,
    ) -> List[UnifiedFunding]:
        """
        Fetch historical funding rates.
        Not all exchanges support this.
        """
        return []

    def fetch_open_interest_history(
        self,
        symbol: str,
        interval: str = "5m",
        limit: int = 100,
        start_time: Optional[int] = None,
    ) -> List[UnifiedOpenInterest]:
        """
        Fetch historical open interest.
        Not all exchanges support this.
        """
        return []

    # ==================== Utility Methods ====================

    def get_supported_intervals(self) -> List[str]:
        """Return list of supported K-line intervals."""
        return ["1m", "5m", "15m", "30m", "1h", "4h", "1d"]

    def is_connected(self) -> bool:
        """Check if the adapter can connect to the exchange."""
        try:
            # Try to fetch a simple endpoint
            self.fetch_funding_rate("BTC")
            return True
        except Exception:
            return False
