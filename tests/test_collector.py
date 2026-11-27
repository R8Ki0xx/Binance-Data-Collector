"""用假的接口数据测试采集逻辑，不需要联网。运行：pytest"""
import pandas as pd
import pytest

from binance_collector.cli import parse_time
from binance_collector.client import BinanceAPIError, BinanceClient
from binance_collector.collector import KlineCollector

HOUR = 3_600_000
START = 1_767_225_600_000  # 2026-01-01 00:00:00 UTC


def make_kline(open_ms, step=HOUR):
    return [open_ms, "100.0", "110.0", "90.0", "105.0", "12.5",
            open_ms + step - 1, "1312.5", 42, "6.0", "630.0", "0"]


class FakeClient:
    """模拟 Binance 接口：按 startTime/endTime 返回最多 1000 根 K 线。"""

    def __init__(self, missing=()):
        self.missing = set(missing)
        self.calls = 0

    def get_klines(self, symbol, interval, start_time=None, end_time=None, limit=1000):
        self.calls += 1
        rows, t = [], start_time - start_time % HOUR
        if t < start_time:
            t += HOUR
        while t <= end_time and len(rows) < limit:
            if t not in self.missing:
                rows.append(make_kline(t))
            t += HOUR
        return rows


@pytest.fixture
def collector(tmp_path):
    return KlineCollector(FakeClient(), str(tmp_path), pause=0)


def test_pagination_covers_whole_range(collector):
    end = START + 2499 * HOUR  # 2500 根，需要翻 3 页
    result = collector.collect("btcusdt", "1h", START, end)

    df = pd.read_csv(result.path, encoding="utf-8-sig")
    assert result.rows == len(df) == 2500
    assert collector.client.calls == 3
    assert df["open_timestamp"].is_monotonic_increasing
    assert df["open_timestamp"].is_unique
    assert df["symbol"].eq("BTCUSDT").all()
    assert df.loc[0, "open_time"] == "2026-01-01 00:00:00"
    assert df["close"].dtype == float


def test_timezone_conversion(tmp_path):
    c = KlineCollector(FakeClient(), str(tmp_path), tz="Asia/Shanghai", pause=0)
    result = c.collect("BTCUSDT", "1h", START, START)
    df = pd.read_csv(result.path, encoding="utf-8-sig")
    assert df.loc[0, "open_time"] == "2026-01-01 08:00:00"


def test_resume_appends_without_duplicates(collector):
    collector.collect("BTCUSDT", "1h", START, START + 99 * HOUR)
    result = collector.collect("BTCUSDT", "1h", START, START + 149 * HOUR, resume=True)

    df = pd.read_csv(result.path, encoding="utf-8-sig")
    assert result.rows == 50  # 只补了新的 50 根
    assert len(df) == 150
    assert df["open_timestamp"].is_unique


def test_without_resume_overwrites(collector):
    collector.collect("BTCUSDT", "1h", START, START + 99 * HOUR)
    result = collector.collect("BTCUSDT", "1h", START, START + 9 * HOUR)
    assert len(pd.read_csv(result.path, encoding="utf-8-sig")) == 10


def test_gap_detection(tmp_path):
    missing = {START + 5 * HOUR, START + 6 * HOUR}
    c = KlineCollector(FakeClient(missing), str(tmp_path), pause=0)
    result = c.collect("BTCUSDT", "1h", START, START + 20 * HOUR)
    assert result.gaps == [(START + 4 * HOUR, START + 7 * HOUR)]


def test_invalid_interval(collector):
    with pytest.raises(ValueError):
        collector.collect("BTCUSDT", "7m", START, START + HOUR)


def test_parse_time_date_only_end_is_end_of_day():
    start = parse_time("2026-01-01", "UTC")
    end = parse_time("2026-01-01", "UTC", end_of_day=True)
    assert start == START
    assert end == START + 86_400_000 - 1


# ---------- 客户端重试逻辑 ----------

class FakeResponse:
    def __init__(self, status, data=None, headers=None):
        self.status_code = status
        self._data = data
        self.headers = headers or {}
        self.text = str(data)

    def json(self):
        return self._data


class FakeSession:
    def __init__(self, responses):
        self.responses = list(responses)
        self.headers = {}
        self.calls = 0

    def get(self, url, params=None, timeout=None):
        self.calls += 1
        return self.responses.pop(0)


def make_client(responses):
    session = FakeSession(responses)
    client = BinanceClient(session=session)
    client._sleep = lambda s: None  # 测试时不真的等待
    return client, session


def test_client_retries_after_rate_limit():
    client, session = make_client([
        FakeResponse(429, headers={"Retry-After": "1"}),
        FakeResponse(503),
        FakeResponse(200, data=[make_kline(START)]),
    ])
    assert len(client.get_klines("BTCUSDT", "1h")) == 1
    assert session.calls == 3


def test_client_does_not_retry_bad_request():
    client, session = make_client([FakeResponse(400, data={"msg": "Invalid symbol."})])
    with pytest.raises(BinanceAPIError):
        client.get_klines("NOTACOIN", "1h")
    assert session.calls == 1


def test_client_gives_up_after_max_retries():
    client, session = make_client([FakeResponse(500)] * 5)
    with pytest.raises(BinanceAPIError):
        client.get_klines("BTCUSDT", "1h")
    assert session.calls == 5
