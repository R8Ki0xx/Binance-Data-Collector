"""K 线采集核心逻辑：自动翻页、转换格式、写入 CSV、断点续传和缺口检查。"""
from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass, field
from typing import Iterator

import pandas as pd
from tqdm import tqdm

from .client import MAX_LIMIT, BinanceClient

logger = logging.getLogger(__name__)

# 每种周期对应的毫秒数（1M 月线长度不固定，不做缺口检查）
INTERVAL_MS = {
    "1s": 1_000,
    "1m": 60_000,
    "3m": 3 * 60_000,
    "5m": 5 * 60_000,
    "15m": 15 * 60_000,
    "30m": 30 * 60_000,
    "1h": 3_600_000,
    "2h": 2 * 3_600_000,
    "4h": 4 * 3_600_000,
    "6h": 6 * 3_600_000,
    "8h": 8 * 3_600_000,
    "12h": 12 * 3_600_000,
    "1d": 86_400_000,
    "3d": 3 * 86_400_000,
    "1w": 7 * 86_400_000,
}
VALID_INTERVALS = [*INTERVAL_MS, "1M"]

# 接口原始返回的 12 个字段
RAW_COLUMNS = [
    "open_time", "open", "high", "low", "close", "volume",
    "close_time", "quote_volume", "trades",
    "taker_buy_base_volume", "taker_buy_quote_volume", "ignore",
]
FLOAT_COLUMNS = [
    "open", "high", "low", "close", "volume",
    "quote_volume", "taker_buy_base_volume", "taker_buy_quote_volume",
]


@dataclass
class CollectResult:
    symbol: str
    interval: str
    path: str
    rows: int = 0
    gaps: list[tuple[int, int]] = field(default_factory=list)  # (缺口前最后一根, 缺口后第一根) 的开盘时间


def iter_kline_pages(
    client: BinanceClient,
    symbol: str,
    interval: str,
    start_ms: int,
    end_ms: int,
    pause: float = 0.2,
) -> Iterator[list[list]]:
    """从开始时间往后一页一页地取，直到结束时间（两端都包含）。"""
    current = start_ms
    while current <= end_ms:
        page = client.get_klines(symbol, interval, start_time=current, end_time=end_ms)
        if not page:
            break
        yield page
        if len(page) < MAX_LIMIT:  # 不满一页，说明已经取完
            break
        current = page[-1][0] + 1  # 下一页从最后一根之后开始
        time.sleep(pause)  # 稍微停一下，对接口友好一点


def to_dataframe(rows: list[list], symbol: str, tz: str = "UTC") -> pd.DataFrame:
    """把接口返回的原始数组转成带表头、类型正确的表格。"""
    df = pd.DataFrame(rows, columns=RAW_COLUMNS).drop(columns="ignore")
    df[FLOAT_COLUMNS] = df[FLOAT_COLUMNS].astype(float)  # 接口返回的价格是字符串
    df["trades"] = df["trades"].astype(int)
    df["open_timestamp"] = df["open_time"].astype("int64")  # 保留毫秒时间戳，方便程序处理
    for col in ("open_time", "close_time"):
        df[col] = (
            pd.to_datetime(df[col], unit="ms", utc=True)
            .dt.tz_convert(tz)
            .dt.strftime("%Y-%m-%d %H:%M:%S")
        )
    df.insert(0, "symbol", symbol.upper())
    return df


def read_last_timestamp(path: str) -> int | None:
    """读取已有 CSV 最后一行的开盘时间戳，用于断点续传。"""
    if not os.path.exists(path) or os.path.getsize(path) == 0:
        return None
    df = pd.read_csv(path, usecols=["open_timestamp"], encoding="utf-8-sig")
    return int(df["open_timestamp"].iloc[-1]) if len(df) else None


class KlineCollector:
    def __init__(self, client: BinanceClient, output_dir: str, tz: str = "UTC", pause: float = 0.2):
        self.client = client
        self.output_dir = output_dir
        self.tz = tz
        self.pause = pause
        os.makedirs(output_dir, exist_ok=True)

    def output_path(self, symbol: str, interval: str) -> str:
        return os.path.join(self.output_dir, f"{symbol.upper()}_{interval}.csv")

    def collect(
        self,
        symbol: str,
        interval: str,
        start_ms: int,
        end_ms: int,
        resume: bool = False,
    ) -> CollectResult:
        """采集一个交易对，结果保存为 输出目录/交易对_周期.csv。"""
        if interval not in VALID_INTERVALS:
            raise ValueError(f"不支持的周期：{interval}，可选：{', '.join(VALID_INTERVALS)}")

        path = self.output_path(symbol, interval)
        result = CollectResult(symbol.upper(), interval, path)
        step = INTERVAL_MS.get(interval)

        last_ts = read_last_timestamp(path) if resume else None
        if last_ts is not None:
            start_ms = max(start_ms, last_ts + 1)
            logger.info("%s 断点续传：从已有数据之后继续", symbol)
        elif os.path.exists(path):
            os.remove(path)  # 不续传就覆盖旧文件

        if start_ms > end_ms:
            logger.info("%s 已是最新，无需下载", symbol)
            return result

        total = (end_ms - start_ms) // step + 1 if step else None
        prev_ts = last_ts
        with tqdm(total=total, desc=f"{symbol.upper()} {interval}", unit="根") as bar:
            for page in iter_kline_pages(self.client, symbol, interval, start_ms, end_ms, self.pause):
                if step:
                    # 缺口检查：相邻两根 K 线的间隔应该正好是一个周期
                    for row in page:
                        if prev_ts is not None and row[0] - prev_ts > step:
                            result.gaps.append((prev_ts, row[0]))
                        prev_ts = row[0]

                df = to_dataframe(page, symbol, self.tz)
                write_header = not os.path.exists(path)
                # utf-8-sig 编码让 Excel 直接打开不乱码
                df.to_csv(path, mode="a", index=False, header=write_header, encoding="utf-8-sig")
                result.rows += len(page)
                bar.update(len(page))

        return result
