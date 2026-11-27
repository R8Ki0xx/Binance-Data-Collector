"""
Offline tests for the Binance collection chain (temporary SQLite, fake network).

Run from backend/:  python -m unittest discover -s tests
"""
import asyncio
import json
import logging
import os
import sys
import tempfile
import threading
import time
import unittest
from decimal import Decimal as D
from pathlib import Path
from unittest import mock

BACKEND = str(Path(__file__).resolve().parents[1])
DB_FILE = os.path.join(tempfile.mkdtemp(), "t.db")
os.environ["DATABASE_URL"] = "sqlite:///" + DB_FILE.replace("\\", "/")
sys.path.insert(0, BACKEND)

import requests
import websocket
from database.connection import SessionLocal, engine
from database import models as m
from services.exchanges import binance_ws_collector as wsmod
from services.exchanges import binance_backfill as bfmod
from services.exchanges.binance_adapter import BinanceAdapter, BinanceRateLimitError
from services.exchanges.binance_collector import binance_collector as rest
from services.exchanges.base_adapter import (
    UnifiedKline, UnifiedOpenInterest, UnifiedFunding, UnifiedSentiment, UnifiedOrderbook,
)
from services.exchanges.data_persistence import ExchangeDataPersistence
from services.market_flow_indicators import _get_oi_data, _get_oi_delta_data

logging.disable(logging.CRITICAL)
TABLES = [t.__table__ for t in (
    m.CryptoKline, m.MarketTradesAggregated, m.MarketOrderbookSnapshots,
    m.MarketAssetMetrics, m.MarketSentimentMetrics, m.BinanceBackfillTask)]


def kline(ts, interval="1m", symbol="BTC"):
    return UnifiedKline("binance", symbol, interval, ts, D(1), D(2), D(1), D(2), D(10), D(20),
                        D(6), D(4), D(12), D(8), 5)


class Base(unittest.TestCase):
    def setUp(self):
        m.Base.metadata.drop_all(engine, tables=TABLES)
        m.Base.metadata.create_all(engine, tables=TABLES)
        BinanceAdapter._blocked_until.clear()
        rest._watermarks.clear()
        rest._job_status.clear()
        self.db = SessionLocal()
        self.p = ExchangeDataPersistence(self.db)

    def tearDown(self):
        self.db.close()


class Response:
    def __init__(self, status=200, body=None, headers=None):
        self.status_code, self.body, self.headers = status, body, headers or {}

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.exceptions.HTTPError(str(self.status_code), response=self)

    def json(self):
        return self.body


class AdapterTests(Base):
    def adapter(self, *results, retries=0):
        a = BinanceAdapter(max_retries=retries)
        a.session.get = mock.Mock(side_effect=list(results))
        return a

    def test_timestamps_are_utc(self):
        a = self.adapter(Response(body={"openInterest": "1", "time": 1234}),
                         Response(body={"openInterest": "1"}))
        self.assertEqual(a.fetch_open_interest("BTC").timestamp, 1234)
        self.assertLess(abs(a.fetch_open_interest("BTC").timestamp - time.time() * 1000), 5000)

    def test_depth_5_and_10_are_separate(self):
        levels = [[str(100 - i), "1"] for i in range(10)]
        book = self.adapter(Response(body={"E": 5, "bids": levels, "asks": levels})).fetch_orderbook("BTC")
        self.assertTrue(self.p.save_orderbook(book))
        row = self.db.query(m.MarketOrderbookSnapshots).one()
        self.assertEqual((row.bid_depth_5, row.bid_depth_10, row.ask_depth_5), (5, 10, 5))

    def test_orderbook_without_top5_falls_back(self):
        self.p.save_orderbook(UnifiedOrderbook("x", "BTC", 1, D(1), D(2), D(7), D(8), D(1), D(1)))
        self.assertEqual(self.db.query(m.MarketOrderbookSnapshots).one().bid_depth_5, 7)

    def test_rate_limit_pauses_all_instances(self):
        a = self.adapter(Response(429, headers={"Retry-After": "30"}), retries=2)
        with self.assertRaises(BinanceRateLimitError):
            a.fetch_price("BTC")
        self.assertEqual(a.session.get.call_count, 1)
        other = self.adapter()
        with self.assertRaises(BinanceRateLimitError):
            other.fetch_price("BTC")
        other.session.get.assert_not_called()
        self.assertAlmostEqual(other.rate_limited_for(), 30, delta=2)
        self.assertEqual(BinanceAdapter(environment="testnet").rate_limited_for(), 0)

    def test_418_default_pause(self):
        a = self.adapter(Response(418))
        with self.assertRaises(BinanceRateLimitError):
            a.fetch_price("BTC")
        self.assertGreater(a.rate_limited_for(), 100)

    def test_retries_only_transient_errors(self):
        with mock.patch("time.sleep"):
            a = self.adapter(requests.exceptions.ConnectionError(), Response(502),
                             Response(body={"price": "5"}), retries=2)
            self.assertEqual(a.fetch_price("BTC"), 5)
            bad = self.adapter(Response(400), retries=2)
            with self.assertRaises(requests.exceptions.HTTPError):
                bad.fetch_price("BTC")
            self.assertEqual(bad.session.get.call_count, 1)
            default = self.adapter(requests.exceptions.Timeout())
            with self.assertRaises(requests.exceptions.Timeout):
                default.fetch_price("BTC")
            self.assertEqual(default.session.get.call_count, 1)

    def test_sentiment_errors_propagate(self):
        with self.assertRaises(requests.exceptions.HTTPError):
            self.adapter(Response(400)).fetch_sentiment_history("BTC")


class PersistenceTests(Base):
    def test_fill_only_missing_minutes(self):
        base = (int(time.time()) // 60 - 30) * 60
        # WebSocket rows: minute 0 has rows inside it, minute 2 only the closing row at +60s
        for ts in (base + 15, base + 180):
            self.db.add(m.MarketTradesAggregated(exchange="binance", symbol="BTC", timestamp=ts * 1000,
                                                 taker_buy_volume=D(1)))
        self.db.commit()
        recent = (int(time.time()) // 60) * 60
        ks = [kline(base), kline(base + 60), kline(base + 120), kline(base + 240),
              kline(recent), kline(base + 300, "5m")]
        first = self.p.fill_missing_taker_volumes_from_klines(ks)
        again = self.p.fill_missing_taker_volumes_from_klines(ks)
        stamps = sorted(r.timestamp // 1000 - base for r in self.db.query(m.MarketTradesAggregated))
        # minute 60 has no row in [60, 120]; minute 120 is covered by the row at 180
        self.assertEqual(stamps, [15, 60, 180, 240])
        self.assertEqual((first["inserted"], again["inserted"]), (2, 0))
        ws_row = self.db.query(m.MarketTradesAggregated).filter_by(timestamp=(base + 15) * 1000).one()
        self.assertEqual(ws_row.taker_buy_volume, 1)

    def test_consecutive_gap_is_filled_completely(self):
        base = (int(time.time()) // 60 - 30) * 60
        for batch in ([kline(base)], [kline(base), kline(base + 60)], [kline(base + 120)]):
            self.p.fill_missing_taker_volumes_from_klines(batch)
        self.assertEqual(self.db.query(m.MarketTradesAggregated).count(), 3)


class CollectorTests(Base):
    def setUp(self):
        super().setUp()
        rest.symbols = ["BTC"]
        self.minute = int(time.time()) // 60 * 60_000

    def patch(self, name, func):
        p = mock.patch.object(rest.adapter, name, side_effect=func)
        self.addCleanup(p.stop)
        return p.start()

    def metrics(self, minutes_ago, oi):
        ts = self.minute - minutes_ago * 60_000 + 5123
        self.patch("fetch_open_interest", lambda s: UnifiedOpenInterest("binance", s, ts - 900, D(oi)))
        self.patch("fetch_premium_index", lambda s: {"timestamp": ts, "funding_rate": D("0.0001"),
                                                     "mark_price": D(100)})
        rest._collect_asset_metrics()

    def test_metrics_share_a_row_and_feed_indicators(self):
        for ago, oi in ((3, 1000), (2, 1010), (1, 1030)):
            self.metrics(ago, oi)
        rows = self.db.query(m.MarketAssetMetrics).all()
        self.assertEqual(len(rows), 3)
        self.assertTrue(all(r.open_interest and r.mark_price and r.funding_rate for r in rows))
        now = int(time.time() * 1000)
        self.assertEqual(_get_oi_data(self.db, "BTC", "1m", 60_000, now, "binance")["current"], 2000.0)
        self.assertAlmostEqual(
            _get_oi_delta_data(self.db, "BTC", "1m", 60_000, now, "binance")["current"], 20 / 1010 * 100)

    def test_partial_metrics_are_saved_and_reported(self):
        self.patch("fetch_open_interest", mock.Mock(side_effect=ValueError("boom")))
        self.patch("fetch_premium_index", lambda s: {"timestamp": self.minute, "funding_rate": D(0),
                                                     "mark_price": D(100)})
        rest._collect_asset_metrics()
        self.assertEqual(self.db.query(m.MarketAssetMetrics).one().mark_price, 100)
        status = rest.get_status()["jobs"]["asset_metrics"]
        self.assertEqual((status["consecutive_failures"], status["last_failed_items"]), (1, ["BTC"]))

    def test_database_error_does_not_poison_other_symbols(self):
        rest.symbols = ["BAD", "BTC"]

        def fetch(symbol, interval, limit):
            k = kline(self.minute // 1000, "5m", symbol)
            if symbol == "BAD":
                k.timestamp = k.timestamp  # duplicate rows violate the unique constraint
                return [k, k]
            return [k]

        self.patch("fetch_sentiment_history", lambda s, i, limit: [
            UnifiedSentiment("binance", s, 1000, D(1), D(1), D(1))] * (2 if s == "BAD" else 1))
        rest._collect_sentiment()
        self.assertEqual([r.symbol for r in self.db.query(m.MarketSentimentMetrics)], ["BTC"])
        status = rest.get_status()["jobs"]["sentiment"]
        self.assertEqual(status["last_failed_items"], ["BAD"])
        self.assertNotIn("PendingRollback", status["last_error"])

    def test_rate_limit_stops_run(self):
        rest.symbols = ["A", "B", "C"]
        fetch = self.patch("fetch_orderbook", mock.Mock(side_effect=BinanceRateLimitError("slow down")))
        rest._collect_orderbook()
        self.assertEqual(fetch.call_count, 1)
        self.assertEqual(rest.get_status()["jobs"]["orderbook"]["last_failed_items"], ["A", "B", "C"])

    def test_success_resets_failures(self):
        rest._record_run("x", ["BTC"], "e")
        rest._record_run("x", [], None)
        status = rest.get_status()["jobs"]["x"]
        self.assertEqual((status["consecutive_failures"], status["last_error"]), (0, None))
        self.assertIsNotNone(status["last_success_at"])

    def test_catch_up_limits(self):
        now = int(time.time())
        limit = lambda last: rest._catch_up_limit((str(last),), lambda: last, 60, 5, 1500)
        self.assertEqual(limit(None), 5)
        self.assertEqual(limit(now - 30), 5)
        self.assertEqual(limit(now - 600), 12)
        self.assertEqual(limit(now - 10 ** 6), 1500)

    def test_catch_up_survives_failed_request(self):
        start = (int(time.time()) // 60 - 100) * 60
        self.p.save_klines([kline(start)])
        limits = []

        def fetch(symbol, interval, limit):
            limits.append(limit)
            if len(limits) == 1:
                raise requests.exceptions.ConnectionError()
            return [kline((int(time.time()) // 60) * 60)]

        self.patch("fetch_klines", fetch)
        for _ in range(3):
            rest._run_job("k", [("BTC", "1m")], rest._collect_symbol_klines)
        self.assertGreaterEqual(limits[0], 102)
        self.assertEqual(limits[1], limits[0])
        self.assertEqual(limits[2], 5)

    def test_start_does_not_block_and_runs_jobs(self):
        called = threading.Event()

        def slow(*a, **k):
            called.set()
            time.sleep(1.5)
            raise requests.exceptions.ConnectionError()

        for name in ("fetch_klines", "fetch_open_interest", "fetch_premium_index",
                     "fetch_sentiment_history", "fetch_orderbook"):
            self.patch(name, slow)
        started = time.monotonic()
        rest.start(["BTC"])
        elapsed = time.monotonic() - started
        try:
            self.assertLess(elapsed, 0.5)
            self.assertTrue(called.wait(2))
            self.assertEqual(len(rest.scheduler.get_jobs()), 4)
        finally:
            rest.stop()
        time.sleep(10)  # let in-flight jobs finish before tables are dropped


class FakeApp:
    instances = []

    def __init__(self, url, on_message, on_error, on_close, on_open):
        self.url, self.on_message, self.on_open = url, on_message, on_open
        self.sent, self.closed, self.opened = [], threading.Event(), threading.Event()
        FakeApp.instances.append(self)

    def run_forever(self, **kwargs):
        self.on_open(self)
        self.opened.set()
        self.closed.wait(10)

    def send(self, data):
        self.sent.append(json.loads(data))

    def close(self):
        self.closed.set()

    def trade(self, symbol="BTCUSDT", qty="1"):
        self.on_message(self, json.dumps({"e": "aggTrade", "s": symbol, "q": qty, "p": "10", "m": False}))


def wait_for(condition, timeout=5):
    end = time.time() + timeout
    while time.time() < end:
        if condition():
            return True
        time.sleep(0.01)
    return False


class WebSocketTests(Base):
    def setUp(self):
        super().setUp()
        FakeApp.instances = []
        for p in (mock.patch.object(websocket, "WebSocketApp", FakeApp),
                  mock.patch.object(wsmod.binance_ws_collector, "_run_signal_detection"),
                  mock.patch.object(wsmod, "RECONNECT_DELAY_SECONDS", 0.3)):
            p.start()
            self.addCleanup(p.stop)
        self.c = wsmod.binance_ws_collector
        self.addCleanup(self.c.stop)

    def connection(self, n):
        self.assertTrue(wait_for(lambda: len(FakeApp.instances) >= n
                                 and FakeApp.instances[n - 1].opened.is_set()))
        return FakeApp.instances[n - 1]

    def live(self):
        return [a for a in FakeApp.instances if not a.closed.is_set()]

    def test_symbol_refresh_keeps_one_connection_and_no_double_count(self):
        self.c.start(["BTC"])
        first = self.connection(1)
        self.assertEqual(first.url, "wss://fstream.binance.com/market/ws")
        first.trade()
        self.c.refresh_symbols(["BTC", "ETH"])
        second = self.connection(2)
        self.assertEqual(second.sent[0]["params"], ["btcusdt@aggTrade", "ethusdt@aggTrade"])
        first.trade()   # late message from the replaced connection
        second.trade()
        self.assertEqual(self.live(), [second])
        self.assertEqual(self.c.trade_buffers["BTC"].taker_buy_count, 2)
        self.c._flush_to_database()
        row = self.db.query(m.MarketTradesAggregated).one()
        self.assertEqual((row.symbol, row.taker_buy_volume, row.taker_buy_count), ("BTC", 2, 2))
        self.assertEqual(self.c.trade_buffers["BTC"].taker_buy_count, 0)
        self.c.refresh_symbols(["ETH", "BTC"])  # same set: nothing to do
        time.sleep(0.1)
        self.assertEqual(len(FakeApp.instances), 2)

    def test_stop_closes_everything_and_restart_is_clean(self):
        self.c.start(["BTC"])
        self.connection(1)
        thread = self.c.ws_thread
        self.c.stop()
        self.assertFalse(thread.is_alive())
        self.assertEqual(self.live(), [])
        self.c.start(["BTC"])
        self.connection(2)
        time.sleep(0.5)
        self.assertEqual(len(self.live()), 1)
        self.assertEqual(len(FakeApp.instances), 2)

    def test_server_close_reconnects_with_delay(self):
        self.c.start(["BTC"])
        first = self.connection(1)
        closed_at = time.monotonic()
        first.close()
        self.connection(2)
        self.assertGreaterEqual(time.monotonic() - closed_at, 0.25)
        self.assertGreaterEqual(self.c.get_status()["reconnect_count"], 1)

    def test_early_timer_does_not_overwrite_previous_window(self):
        self.c.start(["BTC"])
        app = self.connection(1)
        self.c.flush_timer.cancel()
        generation = self.c._generation
        base = (int(time.time()) // 15) * 15
        with mock.patch.object(wsmod.threading, "Timer") as timer:
            for boundary, fired_at in ((base, base + 0.001), (base + 15, base + 14.997)):
                app.trade()
                with mock.patch.object(wsmod.time, "time", return_value=fired_at):
                    self.c._flush_and_reschedule(generation, boundary)
            # Next timer must target the boundary after the one flushed early
            self.assertEqual(timer.call_args.kwargs["args"], (generation, base + 30))
        stamps = sorted(r.timestamp // 1000 - base for r in self.db.query(m.MarketTradesAggregated))
        self.assertEqual(stamps, [0, 15])

    def test_silent_connection_is_replaced(self):
        self.c.start(["BTC"])
        self.connection(1)
        self.c._last_message_monotonic = time.monotonic() - 61
        self.c._reconnect_if_stale()
        self.connection(2)
        self.assertTrue(self.c.get_status()["connected"])


class BackfillTests(Base):
    def run_task(self, **fakes):
        service = bfmod.BinanceBackfillService()
        for name, func in fakes.items():
            setattr(service.adapter, name, func)
        task = m.BinanceBackfillTask(symbols="BTC", status="pending", progress=0)
        self.db.add(task)
        self.db.commit()

        async def no_sleep(_):
            return None

        with mock.patch.object(bfmod.asyncio, "sleep", no_sleep):
            asyncio.run(service.start_backfill(task.id))
        self.db.refresh(task)
        return task

    def test_late_errors_keep_saved_pages(self):
        now = int(time.time() * 1000)
        calls = {"s": 0, "f": 0}
        settled = (now // 28_800_000 - 1) * 28_800_000

        def sentiment(symbol, interval, limit, end_time):
            calls["s"] += 1
            if calls["s"] > 1:
                raise requests.exceptions.HTTPError("400", response=Response(400))
            return [UnifiedSentiment("binance", symbol, now - 300_000, D(1), D(1), D(1))]

        def funding(symbol, limit, end_time):
            calls["f"] += 1
            if calls["f"] > 1:
                raise requests.exceptions.ConnectionError("down")
            return [UnifiedFunding("binance", symbol, settled + 7, D("0.0001"))]

        task = self.run_task(
            fetch_klines=lambda s, p, limit: [kline((now // 60000 - 10) * 60, p, s)],
            fetch_funding_history=funding, fetch_sentiment_history=sentiment)
        self.assertEqual(task.status, "completed")
        self.assertIn("funding", task.error_message)
        self.assertNotIn("sentiment", task.error_message)
        self.assertEqual(self.db.query(m.MarketSentimentMetrics).count(), 1)
        self.assertEqual(self.db.query(m.MarketAssetMetrics).one().timestamp, settled)
        self.assertEqual(self.db.query(m.MarketTradesAggregated).count(), 1)

    def test_everything_failing_marks_task_failed(self):
        def fail(*a, **k):
            raise requests.exceptions.ConnectionError("down")

        task = self.run_task(fetch_klines=fail, fetch_funding_history=fail, fetch_sentiment_history=fail)
        self.assertEqual(task.status, "failed")
        self.assertEqual(len(task.error_message.splitlines()), 5)


class RouteTests(Base):
    def test_status_route(self):
        # Wallet modules need packages missing on this machine; the status route uses none of them
        stubs = {name: mock.MagicMock() for name in (
            "services.binance_trading_client", "services.hyperliquid_environment",
            "utils.encryption")}
        with mock.patch.dict(sys.modules, stubs):
            from api.binance_routes import get_collector_status, router
        status = get_collector_status()
        json.dumps(status)
        self.assertEqual(set(status), {"rest", "websocket"})
        self.assertIn("/api/binance/collector/status", [r.path for r in router.routes])


if __name__ == "__main__":
    unittest.main(verbosity=1)
