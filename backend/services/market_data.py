from typing import Dict, List, Any
import logging
from .hyperliquid_market_data import (
    get_last_price_from_hyperliquid,
    get_kline_data_from_hyperliquid,
    get_market_status_from_hyperliquid,
    get_all_symbols_from_hyperliquid,
    get_ticker_data_from_hyperliquid,
    get_default_hyperliquid_client,
)

logger = logging.getLogger(__name__)


def get_last_price(symbol: str, market: str = "CRYPTO", environment: str = "mainnet") -> float:
    key = f"{symbol}.{market}.{environment}"

    # Check cache first (environment-specific)
    from .price_cache import get_cached_price, cache_price
    cached_price = get_cached_price(symbol, market, environment)
    if cached_price is not None:
        logger.debug(f"Using cached price for {key}: {cached_price}")
        return cached_price

    logger.info(f"Getting real-time price for {key} from API ({environment})...")

    if market.lower() == "binance":
        try:
            from services.exchanges.binance_adapter import BinanceAdapter
            adapter = BinanceAdapter(environment=environment)
            price = adapter.fetch_price(symbol)
            logger.info(f"Got real-time price for {key} from Binance ({environment}): {price}")
            cache_price(symbol, market, price, environment)
            return price
        except Exception as bn_err:
            logger.error(f"Failed to get price from Binance ({environment}): {bn_err}")
            raise Exception(f"Unable to get real-time price for {key}: {bn_err}")

    try:
        price = get_last_price_from_hyperliquid(symbol, environment)
        if price and price > 0:
            logger.info(f"Got real-time price for {key} from Hyperliquid ({environment}): {price}")
            cache_price(symbol, market, price, environment)
            return price
        raise Exception(f"Hyperliquid returned invalid price: {price}")
    except Exception as hl_err:
        logger.error(f"Failed to get price from Hyperliquid ({environment}): {hl_err}")
        raise Exception(f"Unable to get real-time price for {key}: {hl_err}")


def get_kline_data(symbol: str, market: str = "CRYPTO", period: str = "1d", count: int = 100, environment: str = "mainnet", persist: bool = True) -> List[Dict[str, Any]]:
    key = f"{symbol}.{market}.{environment}"

    # Route to appropriate exchange based on market parameter
    if market.lower() == "binance":
        try:
            from services.exchanges.binance_adapter import BinanceAdapter
            from datetime import datetime

            adapter = BinanceAdapter(environment=environment)
            unified_klines = adapter.fetch_klines(symbol, period, limit=count)

            # Convert UnifiedKline to dict format expected by technical indicators
            data = []
            for kline in unified_klines:
                data.append({
                    'timestamp': kline.timestamp,  # Already in seconds from adapter
                    'datetime': datetime.fromtimestamp(kline.timestamp),
                    'open': float(kline.open_price),
                    'high': float(kline.high_price),
                    'low': float(kline.low_price),
                    'close': float(kline.close_price),
                    'volume': float(kline.volume),
                    'amount': float(kline.quote_volume),
                    'chg': None,
                    'percent': None
                })

            if data:
                logger.info(f"Got K-line data for {key} from Binance ({environment}), total {len(data)} items")
                return data
            raise Exception("Binance returned empty K-line data")
        except Exception as bn_err:
            logger.error(f"Failed to get K-line data from Binance ({environment}): {bn_err}")
            raise Exception(f"Unable to get K-line data for {key}: {bn_err}")
    else:
        # Default to Hyperliquid
        try:
            data = get_kline_data_from_hyperliquid(symbol, period, count, persist=persist, environment=environment)
            if data:
                logger.info(f"Got K-line data for {key} from Hyperliquid ({environment}), total {len(data)} items")
                return data
            raise Exception("Hyperliquid returned empty K-line data")
        except Exception as hl_err:
            logger.error(f"Failed to get K-line data from Hyperliquid ({environment}): {hl_err}")
            raise Exception(f"Unable to get K-line data for {key}: {hl_err}")


def get_market_status(symbol: str, market: str = "CRYPTO") -> Dict[str, Any]:
    key = f"{symbol}.{market}"

    try:
        status = get_market_status_from_hyperliquid(symbol)
        logger.info(f"Retrieved market status for {key} from Hyperliquid: {status.get('market_status')}")
        return status
    except Exception as hl_err:
        logger.error(f"Failed to get market status: {hl_err}")
        raise Exception(f"Unable to get market status for {key}: {hl_err}")


def get_all_symbols() -> List[str]:
    """Get all available trading pairs"""
    try:
        symbols = get_all_symbols_from_hyperliquid()
        logger.info(f"Got {len(symbols)} trading pairs from Hyperliquid")
        return symbols
    except Exception as hl_err:
        logger.error(f"Failed to get trading pairs list: {hl_err}")
        return ['BTC/USD', 'ETH/USD', 'SOL/USD']  # default trading pairs


def get_ticker_data(symbol: str, market: str = "CRYPTO", environment: str = "mainnet") -> Dict[str, Any]:
    """Get complete ticker data including 24h change and volume"""
    key = f"{symbol}.{market}.{environment}"
    logger.info(f"[DEBUG] get_ticker_data called for {key} in {environment}")

    # Route to Binance if market is binance
    if market.lower() == "binance":
        try:
            from services.exchanges.binance_adapter import BinanceAdapter
            adapter = BinanceAdapter(environment=environment)
            exchange_symbol = adapter._to_exchange_symbol(symbol)

            # Fetch 24h ticker data from Binance
            ticker = adapter._request("/fapi/v1/ticker/24hr", {"symbol": exchange_symbol})

            # Fetch OI
            oi_data = adapter.fetch_open_interest(symbol)
            open_interest_value = float(oi_data.open_interest) * float(ticker.get('lastPrice', 0)) if oi_data else 0

            # Fetch real-time funding rate using premiumIndex API
            funding_rate = 0
            try:
                premium_data = adapter.fetch_premium_index(symbol)
                funding_rate = float(premium_data["funding_rate"]) if premium_data else 0
            except Exception as e:
                logger.warning(f"Failed to fetch premium index for {symbol}: {e}")

            return {
                'symbol': symbol,
                'price': float(ticker.get('lastPrice', 0)),
                'oracle_price': float(ticker.get('lastPrice', 0)),  # Binance doesn't have oracle price
                'change24h': float(ticker.get('priceChange', 0)),
                'volume24h': float(ticker.get('quoteVolume', 0)),
                'percentage24h': float(ticker.get('priceChangePercent', 0)),
                'open_interest': open_interest_value,
                'funding_rate': funding_rate,
            }
        except Exception as e:
            logger.error(f"Failed to get ticker data from Binance ({environment}): {e}")
            raise Exception(f"Unable to get ticker data for {key}: {e}")

    try:
        logger.info(f"[DEBUG] Calling get_ticker_data_from_hyperliquid for {symbol} in {environment}")
        ticker_data = get_ticker_data_from_hyperliquid(symbol, environment)
        logger.info(f"[DEBUG] get_ticker_data_from_hyperliquid returned: {ticker_data}")
        if ticker_data:
            logger.info(f"Got ticker data for {key}: price={ticker_data['price']}, change24h={ticker_data['change24h']}")
            return ticker_data
        raise Exception("Hyperliquid returned empty ticker data")
    except Exception as hl_err:
        logger.error(f"Failed to get ticker data from Hyperliquid ({environment}): {hl_err}")
        # Fallback to price-only data
        logger.info(f"[DEBUG] Falling back to price-only data for {key}")
        try:
            price = get_last_price(symbol, market, environment)
            fallback_data = {
                'symbol': symbol,
                'price': price,
                'change24h': 0,
                'volume24h': 0,
                'percentage24h': 0,
            }
            logger.info(f"[DEBUG] Returning fallback data for {key}: {fallback_data}")
            return fallback_data
        except Exception:
            raise Exception(f"Unable to get ticker data for {key}: {hl_err}")
