"""命令行入口：python -m binance_collector --help"""
from __future__ import annotations

import argparse
import logging
import sys
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import pandas as pd

from .client import DEFAULT_BASE_URL, BinanceAPIError, BinanceClient
from .collector import VALID_INTERVALS, KlineCollector

TIME_FORMATS = ["%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"]


def parse_time(text: str, tz: str, end_of_day: bool = False) -> int:
    """把 '2026-05-22' 或 '2026-05-22 08:30' 这样的时间转成毫秒时间戳。

    只写日期时：作为开始时间取当天 00:00:00，作为结束时间取当天 23:59:59.999，
    这样 --start 2026-05-22 --end 2026-05-22 就是完整的一天。
    """
    for fmt in TIME_FORMATS:
        try:
            dt = datetime.strptime(text.strip(), fmt)
        except ValueError:
            continue
        if fmt == "%Y-%m-%d" and end_of_day:
            dt = datetime.combine(dt.date(), time.max)
        dt = dt.replace(tzinfo=ZoneInfo(tz))
        return int(dt.timestamp() * 1000)
    raise argparse.ArgumentTypeError(f"无法识别的时间：{text}（示例：2026-05-22 或 '2026-05-22 08:30'）")


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m binance_collector",
        description="批量下载 Binance 历史 K 线数据并保存为 CSV",
    )
    p.add_argument("-s", "--symbols", nargs="+", required=True, help="交易对，可写多个，如 BTCUSDT ETHUSDT")
    p.add_argument("-i", "--interval", default="1h", choices=VALID_INTERVALS, help="K 线周期，默认 1h")
    p.add_argument("--start", required=True, help="开始时间，如 2026-01-01 或 '2026-01-01 08:00'")
    p.add_argument("--end", help="结束时间，默认到当前时间")
    p.add_argument("-o", "--output", default="data", help="输出目录，默认 ./data")
    p.add_argument("--tz", default="UTC", help="时区，影响输入时间的解释和 CSV 中的时间显示，如 Asia/Shanghai，默认 UTC")
    p.add_argument("--resume", action="store_true", help="断点续传：已有 CSV 时只补充之后的新数据")
    p.add_argument("--base-url", default=DEFAULT_BASE_URL, help=f"接口地址，默认 {DEFAULT_BASE_URL}")
    p.add_argument("--pause", type=float, default=0.2, help="每页请求之间的间隔秒数，默认 0.2")
    p.add_argument("-v", "--verbose", action="store_true", help="输出更详细的日志")
    return p


def format_ms(ms: int, tz: str) -> str:
    return pd.Timestamp(ms, unit="ms", tz="UTC").tz_convert(tz).strftime("%Y-%m-%d %H:%M")


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
    )

    try:
        ZoneInfo(args.tz)
        start_ms = parse_time(args.start, args.tz)
        end_ms = parse_time(args.end, args.tz, end_of_day=True) if args.end else int(
            datetime.now().timestamp() * 1000
        )
    except (argparse.ArgumentTypeError, ZoneInfoNotFoundError, ValueError) as e:
        print(f"参数错误：{e}", file=sys.stderr)
        return 2
    if start_ms > end_ms:
        print("参数错误：开始时间晚于结束时间", file=sys.stderr)
        return 2

    client = BinanceClient(base_url=args.base_url)
    collector = KlineCollector(client, args.output, tz=args.tz, pause=args.pause)

    results, failed = [], []
    for symbol in args.symbols:
        try:
            results.append(collector.collect(symbol, args.interval, start_ms, end_ms, resume=args.resume))
        except BinanceAPIError as e:
            logging.error("%s 下载失败：%s", symbol, e)
            failed.append(symbol)

    print("\n========== 下载汇总 ==========")
    for r in results:
        print(f"{r.symbol:<12} {r.rows:>8} 根  ->  {r.path}")
        for before, after in r.gaps[:5]:
            print(f"    ⚠ 数据缺口：{format_ms(before, args.tz)} 到 {format_ms(after, args.tz)} 之间没有数据")
        if len(r.gaps) > 5:
            print(f"    ⚠ 另有 {len(r.gaps) - 5} 处缺口未列出")
    for s in failed:
        print(f"{s:<12} 失败")
    return 1 if failed else 0
