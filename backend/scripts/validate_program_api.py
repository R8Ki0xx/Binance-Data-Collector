#!/usr/bin/env python3
"""
Program Trader API Consistency Validator

This script validates that all documentation layers are consistent with
the actual implementation. Run this after any changes to:
- program_trader/models.py (source of truth)
- program_trader/executor.py (sandbox injection)
- services/ai_program_service.py (AI prompts)
- routes/program_routes.py (_get_available_apis)

Usage:
    python scripts/validate_program_api.py

    Or inside Docker:
    docker exec hyper-arena-app python /app/backend/scripts/validate_program_api.py
"""

import sys
import re
from pathlib import Path
from typing import List

# Determine backend directory
if Path("/app/backend").exists():
    BACKEND_DIR = Path("/app/backend")
else:
    BACKEND_DIR = Path(__file__).parent.parent


class APIValidator:
    def __init__(self):
        self.errors: List[str] = []
        self.warnings: List[str] = []

    def error(self, msg: str):
        self.errors.append(f"ERROR: {msg}")

    def warn(self, msg: str):
        self.warnings.append(f"WARNING: {msg}")

    def validate_all(self) -> bool:
        """Run all validations and return True if no errors."""
        print("=" * 60)
        print("Program Trader API Consistency Validation")
        print("=" * 60)

        self._validate_models()
        self._validate_executor_injection()
        self._validate_prompts()
        self._validate_routes_api()
        self._cross_validate()

        print("\n" + "=" * 60)
        if self.warnings:
            print("\nWarnings:")
            for w in self.warnings:
                print(f"  {w}")

        if self.errors:
            print("\nErrors:")
            for e in self.errors:
                print(f"  {e}")
            print(f"\nValidation FAILED with {len(self.errors)} error(s)")
            return False
        else:
            print("\nValidation PASSED")
            return True

    def _validate_models(self):
        """Validate models.py definitions by parsing the file."""
        print("\n[1/5] Checking models.py...")

        models_path = BACKEND_DIR / "program_trader" / "models.py"
        content = models_path.read_text()

        # Check MarketData class exists and has required attributes
        if "class MarketData" not in content:
            self.error("MarketData class not found in models.py")
            return

        # Check MarketData attributes
        md_attrs = ['available_balance', 'total_equity', 'positions',
                   'trigger_symbol', 'trigger_type', 'prices']
        for attr in md_attrs:
            if f"{attr}:" not in content and f"{attr} =" not in content:
                self.error(f"MarketData missing attribute: {attr}")

        # Check MarketData methods
        md_methods = ['get_indicator', 'get_klines', 'get_flow',
                     'get_regime', 'get_price_change']
        for method in md_methods:
            if f"def {method}" not in content:
                self.error(f"MarketData missing method: {method}")

        # Check Decision class
        if "class Decision" not in content:
            self.error("Decision class not found")
        else:
            # New Decision fields aligned with output_format
            decision_fields = ['operation', 'symbol', 'target_portion_of_balance', 'leverage',
                              'max_price', 'min_price', 'time_in_force',
                              'take_profit_price', 'stop_loss_price',
                              'tp_execution', 'sl_execution', 'reason', 'trading_strategy']
            for field in decision_fields:
                if f"{field}:" not in content:
                    self.error(f"Decision missing field: {field}")

        # Check ActionType enum (kept for backward compatibility)
        if "class ActionType" not in content:
            self.warn("ActionType enum not found (may be removed if using operation strings)")
        else:
            actions = ['BUY', 'SELL', 'CLOSE', 'HOLD']
            for action in actions:
                if f'{action} = ' not in content:
                    self.warn(f"ActionType missing: {action}")

        # Check Position class
        if "class Position" not in content:
            self.error("Position class not found")
        else:
            pos_fields = ['symbol', 'side', 'size', 'entry_price',
                         'unrealized_pnl', 'leverage', 'liquidation_price']
            for field in pos_fields:
                if f"{field}:" not in content:
                    self.error(f"Position missing field: {field}")

        # Check Kline class
        kline_fields = ['timestamp', 'open', 'high', 'low', 'close', 'volume']
        for field in kline_fields:
            pattern = rf"class Kline.*?{field}:"
            if not re.search(pattern, content, re.DOTALL):
                self.warn(f"Kline may be missing field: {field}")

        # Check RegimeInfo class
        if "class RegimeInfo" not in content:
            self.error("RegimeInfo class not found")

        # Check Decision leverage default value
        match = re.search(r'leverage:\s*int\s*=\s*(\d+)', content)
        if match:
            default_leverage = int(match.group(1))
            if default_leverage != 10:
                self.error(f"Decision.leverage default is {default_leverage}, should be 10")

        print("  Models validated")

    def _validate_executor_injection(self):
        """Validate executor.py injects required classes."""
        print("\n[2/5] Checking executor.py sandbox injection...")

        executor_path = BACKEND_DIR / "program_trader" / "executor.py"
        content = executor_path.read_text()

        # Check SAFE_BUILTINS
        required_builtins = [
            'abs', 'min', 'max', 'sum', 'len', 'round',
            'int', 'float', 'str', 'bool', 'list', 'dict',
            'range', 'enumerate', 'zip', 'sorted', 'any', 'all'
        ]
        for builtin in required_builtins:
            if f'"{builtin}"' not in content and f"'{builtin}'" not in content:
                self.warn(f"SAFE_BUILTINS may be missing: {builtin}")

        # Check SAFE_MATH
        required_math = ['sqrt', 'log', 'log10', 'exp', 'pow', 'floor', 'ceil', 'fabs']
        for func in required_math:
            if f'"{func}"' not in content and f"'{func}'" not in content:
                self.warn(f"SAFE_MATH may be missing: {func}")

        # Check restricted_globals injection
        if '"Decision": Decision' not in content and "'Decision': Decision" not in content:
            self.error("executor.py does not inject Decision class")
        if '"ActionType": ActionType' not in content and "'ActionType': ActionType" not in content:
            self.warn("executor.py does not inject ActionType class (may be intentional)")
        if '"MarketData": MarketData' not in content and "'MarketData': MarketData" not in content:
            self.error("executor.py does not inject MarketData class")
        if '"log":' not in content and "'log':" not in content:
            self.warn("executor.py may not inject log() function")

        print("  Executor injection validated")

    def _validate_prompts(self):
        """Validate AI prompts contain correct documentation."""
        print("\n[3/5] Checking ai_program_service.py prompts...")

        service_path = BACKEND_DIR / "services" / "ai_program_service.py"
        content = service_path.read_text()

        # Check PROGRAM_SYSTEM_PROMPT contains key elements
        if 'PROGRAM_SYSTEM_PROMPT' not in content:
            self.error("PROGRAM_SYSTEM_PROMPT not found")
            return

        # Extract PROGRAM_SYSTEM_PROMPT
        match = re.search(r'PROGRAM_SYSTEM_PROMPT\s*=\s*"""(.+?)"""', content, re.DOTALL)
        if not match:
            self.error("Could not parse PROGRAM_SYSTEM_PROMPT")
            return

        prompt = match.group(1)

        # Check indicators are documented
        indicators = ['RSI14', 'RSI7', 'MA5', 'MA10', 'MA20', 'EMA20', 'EMA50',
                     'EMA100', 'MACD', 'BOLL', 'ATR14', 'VWAP', 'STOCH', 'OBV']
        for ind in indicators:
            if ind not in prompt:
                self.error(f"PROGRAM_SYSTEM_PROMPT missing indicator: {ind}")

        # Check flow metrics are documented
        flow_metrics = ['CVD', 'OI', 'OI_DELTA', 'TAKER', 'FUNDING', 'DEPTH', 'IMBALANCE']
        for metric in flow_metrics:
            if f'"{metric}"' not in prompt:
                self.warn(f"PROGRAM_SYSTEM_PROMPT may be missing flow metric: {metric}")

        # Check Position documentation
        if 'Position' not in prompt or 'pos.side' not in prompt:
            self.warn("PROGRAM_SYSTEM_PROMPT may be missing Position documentation")

        # Check math functions documented
        if 'math.sqrt' not in prompt and 'math:' not in prompt:
            self.warn("PROGRAM_SYSTEM_PROMPT may be missing math functions documentation")

        # Check log function documented
        if 'log(' not in prompt and 'log(message)' not in prompt:
            self.warn("PROGRAM_SYSTEM_PROMPT may be missing log() function documentation")

        # Check leverage default value in prompt (various formats)
        leverage_patterns = ['default: 10', '(default: 10)', '1-50']
        if not any(p in prompt for p in leverage_patterns):
            self.warn("PROGRAM_SYSTEM_PROMPT may have wrong leverage default (should be 10)")

        print("  Prompts validated")

    def _validate_routes_api(self):
        """Validate _get_available_apis() in program_routes.py."""
        print("\n[4/5] Checking program_routes.py _get_available_apis()...")

        routes_path = BACKEND_DIR / "routes" / "program_routes.py"
        content = routes_path.read_text()

        if '_get_available_apis' not in content:
            self.error("_get_available_apis not found in program_routes.py")
            return

        # Check key elements
        checks = [
            ('trigger_type', 'MarketData.trigger_type'),
            ('Position_fields', 'Position fields documentation'),
            ('default: 10', 'leverage default value 10'),
            ('operation', 'Decision.operation field'),
            ('target_portion_of_balance', 'Decision.target_portion_of_balance field'),
            ('max_price', 'Decision.max_price field'),
            ('min_price', 'Decision.min_price field'),
        ]

        for check, desc in checks:
            if check not in content:
                self.warn(f"_get_available_apis may be missing: {desc}")

        # Check periods match
        if '"1m", "5m", "15m", "1h", "4h"' not in content:
            self.warn("_get_available_apis periods may not match expected values")

        print("  Routes API validated")

    def _cross_validate(self):
        """Cross-validate consistency between all sources."""
        print("\n[5/5] Cross-validating consistency...")

        # Read all files
        models_content = (BACKEND_DIR / "program_trader" / "models.py").read_text()
        executor_content = (BACKEND_DIR / "program_trader" / "executor.py").read_text()
        service_content = (BACKEND_DIR / "services" / "ai_program_service.py").read_text()
        routes_content = (BACKEND_DIR / "routes" / "program_routes.py").read_text()

        # Check leverage default consistency
        model_leverage = re.search(r'leverage:\s*int\s*=\s*(\d+)', models_content)
        if model_leverage:
            expected = model_leverage.group(1)
            # Check various formats: "default: 10", "(default: 10)", "| 10 |" (table format)
            leverage_patterns = [
                f'default: {expected}',
                f'(default: {expected})',
                f'| {expected} |',  # Table format in DECISION_API_DOCS
            ]
            if not any(p in service_content for p in leverage_patterns):
                self.error(f"DECISION_API_DOCS leverage default doesn't match models.py ({expected})")
            if f'default: {expected}' not in routes_content:
                self.error(f"_get_available_apis leverage default doesn't match models.py ({expected})")

        print("  Cross-validation completed")


def main():
    validator = APIValidator()
    success = validator.validate_all()
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()

