"""
Binance Futures adapter implementation.

Handles data fetching from Binance USDS-M Futures API and converts
to unified internal format.
"""

import logging
import requests
from decimal import Decimal
from typing import List, Optional
from datetime import datetime

from .base_adapter import (
    BaseExchangeAdapter,
    UnifiedKline,
    UnifiedTrade,
    UnifiedOrderbook,
    UnifiedFunding,
    UnifiedOpenInterest,
    UnifiedSentiment,
)
from .symbol_mapper import SymbolMapper

logger = logging.getLogger(__name__)


class BinanceAdapter(BaseExchangeAdapter):
    """
    Binance USDS-M Futures adapter.

    API Documentation: https://developers.binance.com/docs/derivatives/usds-margined-futures
    """

    # API endpoints
    BASE_URL = "https://fapi.binance.com"
    TESTNET_URL = "https://testnet.binancefuture.com"

    def __init__(self, environment: str = "mainnet"):
        super().__init__(environment)
        self.base_url = self.TESTNET_URL if environment == "testnet" else self.BASE_URL
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})

    def _get_exchange_name(self) -> str:
        return "binance"

    def _to_exchange_symbol(self, symbol: str) -> str:
        """Convert internal symbol to Binance format."""
        return SymbolMapper.to_exchange(symbol, "binance")

    def _to_internal_symbol(self, symbol: str) -> str:
        """Convert Binance symbol to internal format."""
        return SymbolMapper.to_internal(symbol, "binance")

    def _request(self, endpoint: str, params: dict = None) -> dict:
        """Make HTTP request to Binance API."""
        url = f"{self.base_url}{endpoint}"
        try:
            response = self.session.get(url, params=params, timeout=10)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            logger.error(f"Binance API request failed: {endpoint} - {e}")
            raise

    def _interval_to_binance(self, interval: str) -> str:
        """Convert internal interval format to Binance format."""
        # Internal and Binance formats are the same for common intervals
        return interval

    # ==================== Price Methods ====================

    def fetch_price(self, symbol: str) -> float:
        """Fetch last price from Binance Futures using /fapi/v1/ticker/price."""
        exchange_symbol = self._to_exchange_symbol(symbol)
        data = self._request("/fapi/v1/ticker/price", {"symbol": exchange_symbol})
        price = float(data.get("price", 0))
        if price <= 0:
            raise ValueError(f"Binance returned invalid price for {exchange_symbol}: {price}")
        return price

    # ==================== Data Fetching Methods ====================

    def fetch_klines(
        self,
        symbol: str,
        interval: str,
        limit: int = 100,
        start_time: Optional[int] = None,
        end_time: Optional[int] = None,
    ) -> List[UnifiedKline]:
        """Fetch K-line data from Binance."""
        exchange_symbol = self._to_exchange_symbol(symbol)
        params = {
            "symbol": exchange_symbol,
            "interval": self._interval_to_binance(interval),
            "limit": min(limit, 1500),  # Binance max is 1500
        }
        if start_time:
            params["startTime"] = start_time
        if end_time:
            params["endTime"] = end_time

        raw_data = self._request("/fapi/v1/klines", params)
        return self._parse_klines(raw_data, symbol, interval)

    def _parse_klines(
        self, raw_data: list, symbol: str, interval: str
    ) -> List[UnifiedKline]:
        """Parse Binance kline response to unified format."""
        klines = []
        for item in raw_data:
            # Binance kline format: [openTime, open, high, low, close, volume,
            #   closeTime, quoteVolume, trades, takerBuyBase, takerBuyQuote, ignore]
            open_time_ms = item[0]
            open_price = Decimal(str(item[1]))
            high_price = Decimal(str(item[2]))
            low_price = Decimal(str(item[3]))
            close_price = Decimal(str(item[4]))
            volume = Decimal(str(item[5]))
            quote_volume = Decimal(str(item[7]))
            trade_count = int(item[8])
            taker_buy_volume = Decimal(str(item[9]))
            taker_buy_notional = Decimal(str(item[10]))  # takerBuyQuoteAssetVolume
            # Taker sell = total - taker buy
            taker_sell_volume = volume - taker_buy_volume
            taker_sell_notional = quote_volume - taker_buy_notional

            klines.append(UnifiedKline(
                exchange="binance",
                symbol=symbol,
                interval=interval,
                timestamp=open_time_ms // 1000,  # Convert to seconds
                open_price=open_price,
                high_price=high_price,
                low_price=low_price,
                close_price=close_price,
                volume=volume,
                quote_volume=quote_volume,
                taker_buy_volume=taker_buy_volume,
                taker_sell_volume=taker_sell_volume,
                taker_buy_notional=taker_buy_notional,
                taker_sell_notional=taker_sell_notional,
                trade_count=trade_count,
            ))
        return klines

    def fetch_orderbook(self, symbol: str, depth: int = 10) -> UnifiedOrderbook:
        """Fetch orderbook snapshot from Binance."""
        exchange_symbol = self._to_exchange_symbol(symbol)
        params = {"symbol": exchange_symbol, "limit": min(depth, 1000)}

        raw_data = self._request("/fapi/v1/depth", params)
        return self._parse_orderbook(raw_data, symbol)

    def _parse_orderbook(self, raw_data: dict, symbol: str) -> UnifiedOrderbook:
        """Parse Binance orderbook response to unified format."""
        timestamp = raw_data.get("E", int(datetime.utcnow().timestamp() * 1000))
        bids = raw_data.get("bids", [])
        asks = raw_data.get("asks", [])

        best_bid = Decimal(str(bids[0][0])) if bids else Decimal("0")
        best_ask = Decimal(str(asks[0][0])) if asks else Decimal("0")

        # Sum top levels for depth
        bid_depth_sum = sum(Decimal(str(b[1])) for b in bids[:10])
        ask_depth_sum = sum(Decimal(str(a[1])) for a in asks[:10])

        spread = best_ask - best_bid
        mid_price = (best_ask + best_bid) / 2
        spread_bps = (spread / mid_price * 10000) if mid_price > 0 else Decimal("0")

        return UnifiedOrderbook(
            exchange="binance",
            symbol=symbol,
            timestamp=timestamp,
            best_bid=best_bid,
            best_ask=best_ask,
            bid_depth_sum=bid_depth_sum,
            ask_depth_sum=ask_depth_sum,
            spread=spread,
            spread_bps=spread_bps,
        )

    def fetch_funding_rate(self, symbol: str) -> UnifiedFunding:
        """Fetch current funding rate from Binance."""
        exchange_symbol = self._to_exchange_symbol(symbol)
        params = {"symbol": exchange_symbol, "limit": 1}

        raw_data = self._request("/fapi/v1/fundingRate", params)
        if not raw_data:
            raise ValueError(f"No funding rate data for {symbol}")

        item = raw_data[0]
        return UnifiedFunding(
            exchange="binance",
            symbol=symbol,
            timestamp=item["fundingTime"],
            funding_rate=Decimal(str(item["fundingRate"])),
            mark_price=Decimal(str(item["markPrice"])) if "markPrice" in item else None,
        )

    def fetch_premium_index(self, symbol: str) -> dict:
        """
        Fetch real-time premium index data from Binance.
        Returns current funding rate, mark price, index price, etc.

        This is different from fetch_funding_rate() which returns historical settled rates.
        Use this for real-time display, use fetch_funding_rate() for historical records.
        """
        exchange_symbol = self._to_exchange_symbol(symbol)
        params = {"symbol": exchange_symbol}

        raw_data = self._request("/fapi/v1/premiumIndex", params)
        return {
            "symbol": symbol,
            "mark_price": Decimal(str(raw_data["markPrice"])),
            "index_price": Decimal(str(raw_data["indexPrice"])),
            "funding_rate": Decimal(str(raw_data["lastFundingRate"])),
            "next_funding_time": raw_data["nextFundingTime"],
            "timestamp": raw_data["time"],
        }

    def fetch_open_interest(self, symbol: str) -> UnifiedOpenInterest:
        """Fetch current open interest from Binance."""
        exchange_symbol = self._to_exchange_symbol(symbol)
        params = {"symbol": exchange_symbol}

        raw_data = self._request("/fapi/v1/openInterest", params)
        return UnifiedOpenInterest(
            exchange="binance",
            symbol=symbol,
            timestamp=int(datetime.utcnow().timestamp() * 1000),
            open_interest=Decimal(str(raw_data["openInterest"])),
        )

    def fetch_sentiment(self, symbol: str) -> Optional[UnifiedSentiment]:
        """Fetch long/short ratio from Binance (unique to Binance)."""
        exchange_symbol = self._to_exchange_symbol(symbol)
        params = {"symbol": exchange_symbol, "period": "5m", "limit": 1}

        try:
            raw_data = self._request("/futures/data/topLongShortPositionRatio", params)
            if not raw_data:
                return None

            item = raw_data[0]
            return UnifiedSentiment(
                exchange="binance",
                symbol=symbol,
                timestamp=item["timestamp"],
                long_ratio=Decimal(str(item["longAccount"])),
                short_ratio=Decimal(str(item["shortAccount"])),
                long_short_ratio=Decimal(str(item["longShortRatio"])),
            )
        except Exception as e:
            logger.warning(f"Failed to fetch sentiment for {symbol}: {e}")
            return None

    # ==================== Historical Data Methods ====================

    def fetch_funding_history(
        self,
        symbol: str,
        limit: int = 100,
        start_time: Optional[int] = None,
        end_time: Optional[int] = None,
    ) -> List[UnifiedFunding]:
        """Fetch historical funding rates (Binance supports full history)."""
        exchange_symbol = self._to_exchange_symbol(symbol)
        params = {"symbol": exchange_symbol, "limit": min(limit, 1000)}
        if start_time:
            params["startTime"] = start_time
        if end_time:
            params["endTime"] = end_time

        raw_data = self._request("/fapi/v1/fundingRate", params)
        results = []
        for item in raw_data:
            mark_price_str = item.get("markPrice")
            mark_price = None
            if mark_price_str and str(mark_price_str).strip():
                try:
                    mark_price = Decimal(str(mark_price_str))
                except Exception:
                    pass
            results.append(UnifiedFunding(
                exchange="binance",
                symbol=symbol,
                timestamp=item["fundingTime"],
                funding_rate=Decimal(str(item["fundingRate"])),
                mark_price=mark_price,
            ))
        return results

    def fetch_open_interest_history(
        self,
        symbol: str,
        interval: str = "5m",
        limit: int = 100,
        start_time: Optional[int] = None,
        end_time: Optional[int] = None,
    ) -> List[UnifiedOpenInterest]:
        """Fetch historical OI (Binance supports 30 days)."""
        exchange_symbol = self._to_exchange_symbol(symbol)
        params = {
            "symbol": exchange_symbol,
            "period": interval,
            "limit": min(limit, 500),
        }
        if start_time:
            params["startTime"] = start_time
        if end_time:
            params["endTime"] = end_time

        raw_data = self._request("/futures/data/openInterestHist", params)
        return [
            UnifiedOpenInterest(
                exchange="binance",
                symbol=symbol,
                timestamp=item["timestamp"],
                open_interest=Decimal(str(item["sumOpenInterest"])),
                open_interest_value=Decimal(str(item["sumOpenInterestValue"])),
            )
            for item in raw_data
        ]

    def fetch_sentiment_history(
        self,
        symbol: str,
        interval: str = "5m",
        limit: int = 100,
        start_time: Optional[int] = None,
        end_time: Optional[int] = None,
    ) -> List[UnifiedSentiment]:
        """Fetch historical long/short ratio (Binance supports 30 days)."""
        exchange_symbol = self._to_exchange_symbol(symbol)
        params = {
            "symbol": exchange_symbol,
            "period": interval,
            "limit": min(limit, 500),
        }
        if start_time:
            params["startTime"] = start_time
        if end_time:
            params["endTime"] = end_time

        try:
            raw_data = self._request("/futures/data/topLongShortPositionRatio", params)
            return [
                UnifiedSentiment(
                    exchange="binance",
                    symbol=symbol,
                    timestamp=item["timestamp"],
                    long_ratio=Decimal(str(item["longAccount"])),
                    short_ratio=Decimal(str(item["shortAccount"])),
                    long_short_ratio=Decimal(str(item["longShortRatio"])),
                )
                for item in raw_data
            ]
        except Exception as e:
            logger.warning(f"Failed to fetch sentiment history for {symbol}: {e}")
            return []
