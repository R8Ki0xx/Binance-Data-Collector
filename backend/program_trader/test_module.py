#!/usr/bin/env python3
"""
Test script for Program Trader module.
Run from backend directory: python3 -m program_trader.test_module
"""

import sys
sys.path.insert(0, '/home/wwwroot/hyper-alpha-arena-prod/backend')

from program_trader import (
    validate_strategy_code,
    execute_strategy,
    MarketData,
    Decision,
    ActionType,
)


def test_validator():
    """Test code validator."""
    print("\n=== Testing Code Validator ===")

    # Valid code
    valid_code = '''
class MyStrategy:
    def init(self, params):
        self.threshold = params.get("threshold", 30)

    def should_trade(self, data):
        rsi = data.get_indicator(data.trigger_symbol, "RSI14", "5m")
        if rsi.get("value", 50) < self.threshold:
            return Decision(
                action=ActionType.BUY,
                symbol=data.trigger_symbol,
                size_usd=1000,
                leverage=10,
                reason="RSI oversold"
            )
        return Decision(operation="hold", symbol=data.trigger_symbol)
'''
    result = validate_strategy_code(valid_code)
    print(f"Valid code test: is_valid={result.is_valid}, errors={result.errors}")
    assert result.is_valid, f"Valid code should pass: {result.errors}"

    # Invalid code - syntax error
    invalid_syntax = '''
class MyStrategy:
    def should_trade(self, data)
        return Decision(operation="hold", symbol="BTC")
'''
    result = validate_strategy_code(invalid_syntax)
    print(f"Syntax error test: is_valid={result.is_valid}, errors={result.errors}")
    assert not result.is_valid, "Syntax error should fail"

    # Invalid code - forbidden import
    forbidden_import = '''
import os
class MyStrategy:
    def should_trade(self, data):
        os.system("rm -rf /")
        return Decision(operation="hold", symbol="BTC")
'''
    result = validate_strategy_code(forbidden_import)
    print(f"Forbidden import test: is_valid={result.is_valid}, errors={result.errors}")
    assert not result.is_valid, "Forbidden import should fail"

    # Invalid code - pre-injected math should not be imported
    imported_math = '''
import math
class MyStrategy:
    def should_trade(self, data):
        return Decision(operation="hold", symbol="BTC", reason=str(math.sqrt(4)))
'''
    result = validate_strategy_code(imported_math)
    print(f"Import math test: is_valid={result.is_valid}, errors={result.errors}")
    assert not result.is_valid, "import math should fail validation"

    # Invalid code - pre-injected time should not be imported
    imported_time = '''
import time
class MyStrategy:
    def should_trade(self, data):
        return Decision(operation="hold", symbol="BTC", reason=str(time.time()))
'''
    result = validate_strategy_code(imported_time)
    print(f"Import time test: is_valid={result.is_valid}, errors={result.errors}")
    assert not result.is_valid, "import time should fail validation"

    # Invalid code - missing should_trade
    missing_method = '''
class MyStrategy:
    def init(self, params):
        pass
'''
    result = validate_strategy_code(missing_method)
    print(f"Missing method test: is_valid={result.is_valid}, errors={result.errors}")
    assert not result.is_valid, "Missing should_trade should fail"

    print("All validator tests passed!")


def test_executor():
    """Test sandbox executor."""
    print("\n=== Testing Sandbox Executor ===")

    code = '''
class SimpleStrategy:
    def init(self, params):
        self.buy_threshold = params.get("buy_threshold", 30)

    def should_trade(self, data):
        # Simple strategy: always hold
        log(f"Processing {data.trigger_symbol}")
        return Decision(
            operation="hold",
            symbol=data.trigger_symbol,
            reason="Test strategy - always hold"
        )
'''

    # Create mock market data
    market_data = MarketData(
        available_balance=10000.0,
        total_equity=10000.0,
        trigger_symbol="BTC",
        trigger_type="signal",
    )

    result = execute_strategy(code, market_data, {"buy_threshold": 25})
    print(f"Execution result: success={result.success}, error={result.error}")
    print(f"Decision: {result.decision}")
    print(f"Execution time: {result.execution_time_ms:.2f}ms")

    assert result.success, f"Execution should succeed: {result.error}"
    assert result.decision.operation == ActionType.HOLD
    print("Executor test passed!")


def test_preinjected_modules():
    """Test pre-injected sandbox modules."""
    print("\n=== Testing Pre-injected Modules ===")

    code = '''
class UtilityStrategy:
    def should_trade(self, data):
        price_root = math.sqrt(16)
        current_ts = int(time.time())
        return Decision(
            operation="hold",
            symbol=data.trigger_symbol,
            reason=f"sqrt={price_root}, ts={current_ts}"
        )
'''

    market_data = MarketData(
        available_balance=10000.0,
        total_equity=10000.0,
        trigger_symbol="BTC",
        trigger_type="signal",
    )

    result = execute_strategy(code, market_data)
    print(f"Pre-injected modules result: success={result.success}, error={result.error}")

    assert result.success, f"Pre-injected modules should succeed: {result.error}"
    assert "sqrt=4.0" in (result.decision.reason or "")
    print("Pre-injected modules test passed!")


def test_timeout():
    """Test execution timeout."""
    print("\n=== Testing Timeout ===")

    infinite_loop = '''
class BadStrategy:
    def should_trade(self, data):
        while True:
            pass
        return Decision(operation="hold", symbol="BTC")
'''

    market_data = MarketData(trigger_symbol="BTC")
    result = execute_strategy(infinite_loop, market_data, timeout_seconds=2)
    print(f"Timeout test: success={result.success}, error={result.error}")
    assert not result.success, "Infinite loop should timeout"
    assert "timed out" in result.error.lower() or "timeout" in result.error.lower(), f"Error should mention timeout: {result.error}"
    print("Timeout test passed!")


def test_market_data_factor_proxy():
    """Test MarketData.get_factor period forwarding."""
    print("\n=== Testing MarketData Factor Proxy ===")

    class MockProvider:
        def get_factor(self, symbol, factor_name, period):
            return {
                "factor_name": factor_name,
                "symbol": symbol,
                "period": period,
                "value": 1.23,
            }

    market_data = MarketData(trigger_symbol="BTC", _data_provider=MockProvider())
    result = market_data.get_factor("BTC", "RSI21", "1h")
    print(f"Factor proxy result: {result}")

    assert result["factor_name"] == "RSI21"
    assert result["period"] == "1h"
    print("MarketData factor proxy test passed!")


if __name__ == "__main__":
    try:
        test_validator()
        test_executor()
        test_preinjected_modules()
        test_timeout()
        test_market_data_factor_proxy()
        print("\n=== All tests passed! ===")
    except Exception as e:
        print(f"\nTest failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
