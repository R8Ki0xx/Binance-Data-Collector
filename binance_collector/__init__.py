"""Binance 历史 K 线数据采集工具。"""
from .client import BinanceAPIError, BinanceClient
from .collector import CollectResult, KlineCollector

__all__ = ["BinanceClient", "BinanceAPIError", "KlineCollector", "CollectResult"]
__version__ = "1.0.0"
