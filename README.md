# Binance Data Collector

[![tests](https://github.com/R8Ki0xx/Binance-Data-Collector/actions/workflows/tests.yml/badge.svg)](https://github.com/R8Ki0xx/Binance-Data-Collector/actions/workflows/tests.yml)
![Python](https://img.shields.io/badge/python-3.9%2B-blue)
![License](https://img.shields.io/badge/license-Apache%202.0-green)

一个命令行工具，用来批量下载 Binance 的历史 K 线数据，并保存成可以直接用 Excel 或 Pandas 分析的 CSV 文件。

> **English:** A command-line tool that downloads historical candlestick (kline) data from Binance's public market-data API for multiple trading pairs and saves it as clean CSV files. It supports automatic pagination, retry and rate-limit handling, resumable downloads, timezone conversion and gap detection. No API key required.

## 功能

- **多币种批量下载**：一次下载多个交易对，如 BTCUSDT、ETHUSDT、SOLUSDT
- **自动翻页**：接口一次最多返回 1000 根，工具会自动分页取完整个时间段
- **支持所有周期**：1s、1m、5m、15m、1h、4h、1d、1w、1M 等
- **稳定性**：网络异常和服务器错误自动重试（指数退避）；触发限频时按服务器要求等待
- **断点续传**：加上 `--resume`，只补充已有文件之后的新数据，适合每天定时更新
- **数据整理**：价格转成数值类型，时间转成易读格式，可指定时区（如北京时间）
- **缺口检查**：下载完自动检查有没有缺失的 K 线并列出来（比如交易所维护期间）
- **Excel 友好**：CSV 用 UTF-8 with BOM 编码，Excel 直接打开不乱码
- **有单元测试**：核心逻辑用模拟数据测试，不需要联网，GitHub Actions 自动运行

## 安装

需要 Python 3.9 及以上。

```bash
git clone https://github.com/R8Ki0xx/Binance-Data-Collector.git
cd Binance-Data-Collector
pip install -r requirements.txt
```

## 使用

```bash
# 下载 BTC 和 ETH 在 2026 年 1 月的 1 小时 K 线
python -m binance_collector -s BTCUSDT ETHUSDT -i 1h --start 2026-01-01 --end 2026-01-31

# 下载 1 分钟线，时间按北京时间解释和显示，保存到 my_data 目录
python -m binance_collector -s BTCUSDT SOLUSDT -i 1m --start "2026-05-22 08:00" --end "2026-05-22 20:00" --tz Asia/Shanghai -o my_data

# 从年初下载到现在；之后再运行同一条命令只会补充新数据
python -m binance_collector -s BTCUSDT -i 1d --start 2026-01-01 --resume
```

运行时会显示进度条，结束后输出汇总：

```
========== 下载汇总 ==========
BTCUSDT           744 根  ->  data/BTCUSDT_1h.csv
ETHUSDT           744 根  ->  data/ETHUSDT_1h.csv
```

### 参数

| 参数 | 说明 | 默认值 |
|---|---|---|
| `-s, --symbols` | 交易对，可写多个 | 必填 |
| `-i, --interval` | K 线周期 | `1h` |
| `--start` | 开始时间，如 `2026-01-01` 或 `"2026-01-01 08:00"` | 必填 |
| `--end` | 结束时间；只写日期时包含当天全天 | 当前时间 |
| `-o, --output` | 输出目录 | `data` |
| `--tz` | 时区，如 `Asia/Shanghai` | `UTC` |
| `--resume` | 断点续传 | 关闭 |
| `--base-url` | 接口地址，可换成 `https://api.binance.com` 等官方域名 | `https://data-api.binance.vision` |
| `--pause` | 每页请求间隔（秒） | `0.2` |
| `-v, --verbose` | 输出详细日志 | 关闭 |

> 如果所在网络无法直接访问 Binance，可以设置系统代理或环境变量 `HTTPS_PROXY`，工具会自动使用。

## 输出格式

每个交易对保存为一个文件：`输出目录/交易对_周期.csv`，例如 `data/BTCUSDT_1h.csv`。

| 字段 | 含义 |
|---|---|
| `symbol` | 交易对 |
| `open_time` | 开盘时间（按 `--tz` 显示） |
| `open` / `high` / `low` / `close` | 开盘价 / 最高价 / 最低价 / 收盘价 |
| `volume` | 成交量（以基础币计，如 BTC） |
| `close_time` | 收盘时间 |
| `quote_volume` | 成交额（以计价币计，如 USDT） |
| `trades` | 成交笔数 |
| `taker_buy_base_volume` | 主动买入成交量 |
| `taker_buy_quote_volume` | 主动买入成交额 |
| `open_timestamp` | 开盘时间的毫秒时间戳，方便程序处理 |

用 Pandas 读取：

```python
import pandas as pd

df = pd.read_csv("data/BTCUSDT_1h.csv", parse_dates=["open_time"])
print(df[["open_time", "close"]].tail())
```

## 在代码中调用

```python
from binance_collector import BinanceClient, KlineCollector

collector = KlineCollector(BinanceClient(), output_dir="data", tz="Asia/Shanghai")
result = collector.collect("BTCUSDT", "4h", start_ms=1767225600000, end_ms=1769904000000)
print(result.rows, result.path, result.gaps)
```

## 项目结构

```
binance_collector/
├── client.py      # 接口请求：重试、限频处理
├── collector.py   # 采集逻辑：翻页、格式转换、写 CSV、断点续传、缺口检查
├── cli.py         # 命令行参数解析
└── __main__.py    # python -m binance_collector 入口
tests/
└── test_collector.py
```

## 运行测试

```bash
pip install pytest
pytest
```

## 说明

- 只使用 Binance 的公开行情接口，不需要 API Key，不涉及账户和交易。
- 数据仅供学习和研究使用，不构成任何投资建议。

## License

[Apache License 2.0](LICENSE)
