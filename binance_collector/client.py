"""Binance 公开行情接口客户端：负责发请求、失败重试和限频处理。

只用到不需要 API Key 的公开接口，不涉及任何账户或交易操作。
"""
from __future__ import annotations

import logging
import time

import requests

logger = logging.getLogger(__name__)

# data-api.binance.vision 是 Binance 官方提供的公开行情专用域名，
# 也可以换成 https://api.binance.com 等其他官方域名（见 --base-url 参数）。
DEFAULT_BASE_URL = "https://data-api.binance.vision"
KLINES_PATH = "/api/v3/klines"
MAX_LIMIT = 1000  # 接口单次最多返回 1000 根 K 线


class BinanceAPIError(Exception):
    """接口返回错误，或多次重试后仍然失败。"""


class BinanceClient:
    def __init__(
        self,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = 10,
        max_retries: int = 5,
        backoff: float = 1.0,
        session: requests.Session | None = None,
    ):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.max_retries = max_retries
        self.backoff = backoff
        self.session = session or requests.Session()
        self.session.headers.update({"User-Agent": "binance-data-collector/1.0"})
        self._sleep = time.sleep  # 单独存一份，方便测试时替换掉

    def get_klines(
        self,
        symbol: str,
        interval: str,
        start_time: int | None = None,
        end_time: int | None = None,
        limit: int = MAX_LIMIT,
    ) -> list[list]:
        """获取一页 K 线数据，时间参数单位为毫秒。"""
        params = {"symbol": symbol.upper(), "interval": interval, "limit": limit}
        if start_time is not None:
            params["startTime"] = start_time
        if end_time is not None:
            params["endTime"] = end_time
        return self._get(KLINES_PATH, params)

    def _get(self, path: str, params: dict):
        url = self.base_url + path
        for attempt in range(1, self.max_retries + 1):
            try:
                resp = self.session.get(url, params=params, timeout=self.timeout)
            except requests.RequestException as e:
                self._wait_backoff(attempt, f"网络异常：{e}")
                continue

            if resp.status_code == 200:
                return resp.json()

            if resp.status_code in (418, 429):
                # 触发限频：按服务器给的 Retry-After 等待，避免被封 IP
                wait = float(resp.headers.get("Retry-After", 60))
                logger.warning("触发限频（HTTP %d），等待 %.0f 秒后重试", resp.status_code, wait)
                self._sleep(wait)
                continue

            if resp.status_code >= 500:
                self._wait_backoff(attempt, f"服务器错误 HTTP {resp.status_code}")
                continue

            # 其余 4xx 一般是参数问题（比如交易对写错），重试也没用，直接报错
            raise BinanceAPIError(f"HTTP {resp.status_code}：{resp.text[:200]}")

        raise BinanceAPIError(f"已重试 {self.max_retries} 次仍然失败：{url}")

    def _wait_backoff(self, attempt: int, reason: str) -> None:
        """指数退避：第 1 次等 1 秒，第 2 次 2 秒，第 3 次 4 秒……"""
        if attempt >= self.max_retries:  # 最后一次失败就不用再等了
            logger.warning("%s（第 %d/%d 次）", reason, attempt, self.max_retries)
            return
        wait = self.backoff * 2 ** (attempt - 1)
        logger.warning("%s（第 %d/%d 次），%.1f 秒后重试", reason, attempt, self.max_retries, wait)
        self._sleep(wait)
