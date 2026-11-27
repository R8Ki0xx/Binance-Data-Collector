# Modified by QuantPilot contributors (2026). See NOTICE.
from pydantic import BaseModel
from typing import Dict
import os


class MarketConfig(BaseModel):
    market: str
    min_commission: float
    commission_rate: float
    exchange_rate: float
    min_order_quantity: int = 1
    lot_size: int = 1


class HyperliquidBuilderConfig(BaseModel):
    """Optional Hyperliquid builder fee charged on mainnet orders (off by default)"""
    builder_address: str
    builder_fee: int  # Fee in tenths of basis point (30 = 0.03%)

    @property
    def enabled(self) -> bool:
        return bool(self.builder_address) and self.builder_fee > 0


#  default configs for CRYPTO markets
DEFAULT_TRADING_CONFIGS: Dict[str, MarketConfig] = {
    "CRYPTO": MarketConfig(
        market="CRYPTO",
        min_commission=0.1,  # $0.1 minimum commission for crypto
        commission_rate=0.001,  # 0.1% commission rate (typical for crypto)
        exchange_rate=1.0,  # USD base
        min_order_quantity=1,  # Can trade fractional amounts
        lot_size=1,
    ),
}

# Set HYPERLIQUID_BUILDER_ADDRESS to charge your own builder fee; empty means no fee
HYPERLIQUID_BUILDER_CONFIG = HyperliquidBuilderConfig(
    builder_address=os.getenv("HYPERLIQUID_BUILDER_ADDRESS", ""),
    builder_fee=int(os.getenv("HYPERLIQUID_BUILDER_FEE", "30"))  # 0.03% when enabled
)


class BinanceBrokerConfig(BaseModel):
    """Binance Broker Configuration for fee rebates"""
    broker_id: str  # Broker ID for fee rebates

    @property
    def enabled(self) -> bool:
        return bool(self.broker_id)


# Binance Broker Configuration (optional, for fee rebates)
BINANCE_BROKER_CONFIG = BinanceBrokerConfig(
    broker_id=os.getenv("BINANCE_BROKER_ID", "")  # Empty if not a broker
)

# Binance Daily Quota for non-rebate mainnet accounts (only applied when a broker ID is set)
# This limits the number of AI-executed trades per day to prevent excessive API usage
BINANCE_DAILY_QUOTA_LIMIT = 40

# Factor Engine toggle (set to "true" to enable factor computation)
FACTOR_ENGINE_ENABLED = os.getenv("FACTOR_ENGINE_ENABLED", "false").lower() == "true"
