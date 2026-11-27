"""
Builder fee, broker prefix and daily quota stay off unless the operator configures them.

Run from backend/:  python -m unittest discover -s tests
"""
import os
import sys
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

BACKEND = str(Path(__file__).resolve().parents[1])
_TMP = tempfile.mkdtemp().replace("\\", "/")
os.environ.setdefault("DATABASE_URL", f"sqlite:///{_TMP}/fees.db")
os.environ.setdefault("SNAPSHOT_DATABASE_URL", f"sqlite:///{_TMP}/snapshots.db")
try:
    import pandas_ta  # noqa: F401
except ImportError:
    # The pinned pandas-ta release does not import on Windows; nothing here uses it
    sys.modules["pandas_ta"] = mock.MagicMock()
for name in ("HYPERLIQUID_BUILDER_ADDRESS", "HYPERLIQUID_BUILDER_FEE", "BINANCE_BROKER_ID"):
    os.environ.pop(name, None)
sys.path.insert(0, BACKEND)

from config import settings
from api.account_routes import (
    approve_builder_fee, check_builder_authorization, check_mainnet_accounts,
)
from services import trading_commands
from services.binance_trading_client import BinanceTradingClient
from services.hyperliquid_trading_client import HyperliquidTradingClient
from services.program_execution_service import ProgramExecutionService

ADDRESS = "0x" + "1" * 40


class BuilderFeeTests(unittest.TestCase):
    def builder_params(self, environment):
        client = SimpleNamespace(environment=environment)
        return HyperliquidTradingClient._get_builder_params(client)

    def test_off_by_default(self):
        self.assertFalse(settings.HYPERLIQUID_BUILDER_CONFIG.enabled)
        self.assertIsNone(self.builder_params("mainnet"))

    def test_configured_address_is_used_on_mainnet_only(self):
        config = settings.HyperliquidBuilderConfig(builder_address=ADDRESS, builder_fee=10)
        with mock.patch.object(settings, "HYPERLIQUID_BUILDER_CONFIG", config):
            self.assertEqual(self.builder_params("mainnet"), {"b": ADDRESS, "f": 10})
            self.assertIsNone(self.builder_params("testnet"))

    def test_authorization_endpoints_do_nothing_when_off(self):
        # db=None proves nothing is queried and no exchange request is needed
        self.assertTrue(check_builder_authorization(ADDRESS, db=None)["authorized"])
        self.assertTrue(approve_builder_fee(1, db=None)["success"])
        self.assertEqual(check_mainnet_accounts(db=None), {"unauthorized_accounts": []})


class BrokerTests(unittest.TestCase):
    def order_params(self, broker_id):
        client = BinanceTradingClient("k" * 16, "s" * 16, environment="testnet")
        client.broker_id = broker_id
        precision = {"step_size": Decimal("0.001"), "min_qty": Decimal("0.001"), "tick_size": Decimal("0.1")}
        with mock.patch.object(client, "_get_precision", return_value=precision), \
                mock.patch.object(client, "_request", return_value={}) as request:
            try:
                client.place_order("BTC", "BUY", 0.01)
            except Exception:
                pass  # only the outgoing parameters matter here
        orders = [c for c in request.call_args_list if c.args[1] == "/fapi/v1/order"]
        return orders[0].args[2]

    def test_no_client_order_id_without_broker(self):
        self.assertNotIn("newClientOrderId", self.order_params(""))

    def test_broker_prefix_when_configured(self):
        self.assertTrue(self.order_params("abc")["newClientOrderId"].startswith("x-abc-"))

    def test_no_daily_quota_without_broker(self):
        self.assertFalse(trading_commands._check_binance_daily_quota(None, 1)[0])
        service = ProgramExecutionService()
        self.assertFalse(service._check_binance_daily_quota(None, 1)[0])


if __name__ == "__main__":
    unittest.main()
