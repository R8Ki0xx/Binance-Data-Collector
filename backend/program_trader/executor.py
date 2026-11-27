"""
Sandbox executor for Program Trader.
Safely executes strategy code with restricted environment.
"""

import ast
import math
import time as pytime
from typing import Dict, Any, Optional, List
from dataclasses import dataclass
from concurrent.futures import ThreadPoolExecutor, Future
import threading
import ctypes
import traceback

from .models import Strategy, MarketData, Decision, ActionType
from .validator import validate_strategy_code


@dataclass
class ExecutionResult:
    """Result of strategy execution."""
    success: bool
    decision: Optional[Decision]
    error: Optional[str]
    execution_time_ms: float
    logs: List[str] = None

    def __post_init__(self):
        if self.logs is None:
            self.logs = []


class ExecutionTimeoutError(Exception):
    """Raised when execution times out."""
    pass


# Safe built-ins for sandbox
SAFE_BUILTINS = {
    # Required for class definition
    "__build_class__": __builtins__["__build_class__"] if isinstance(__builtins__, dict) else getattr(__builtins__, "__build_class__"),
    "__name__": "__main__",
    # Basic types and functions
    "abs": abs,
    "min": min,
    "max": max,
    "sum": sum,
    "len": len,
    "round": round,
    "int": int,
    "float": float,
    "str": str,
    "bool": bool,
    "list": list,
    "dict": dict,
    "tuple": tuple,
    "set": set,
    "range": range,
    "enumerate": enumerate,
    "zip": zip,
    "sorted": sorted,
    "reversed": reversed,
    "any": any,
    "all": all,
    "isinstance": isinstance,
    "type": type,
    "True": True,
    "False": False,
    "None": None,
    "print": print,  # For debugging
}

# Safe math functions
SAFE_MATH = {
    "sqrt": math.sqrt,
    "log": math.log,
    "log10": math.log10,
    "exp": math.exp,
    "pow": math.pow,
    "floor": math.floor,
    "ceil": math.ceil,
    "fabs": math.fabs,
}

# Safe time functions
SAFE_TIME = {
    "time": pytime.time,
}


def _raise_timeout_in_thread(thread_id: int):
    """Raise ExecutionTimeoutError in the target thread using ctypes."""
    res = ctypes.pythonapi.PyThreadState_SetAsyncExc(
        ctypes.c_ulong(thread_id),
        ctypes.py_object(ExecutionTimeoutError)
    )
    if res == 0:
        pass  # Thread already finished
    elif res > 1:
        # Reset if multiple threads affected
        ctypes.pythonapi.PyThreadState_SetAsyncExc(ctypes.c_ulong(thread_id), None)


class SandboxExecutor:
    """Executes strategy code in a restricted environment."""

    def __init__(self, timeout_seconds: int = 60, thread_pool: Optional[ThreadPoolExecutor] = None):
        self.timeout_seconds = timeout_seconds
        self._execution_logs: list = []
        self._thread_pool = thread_pool  # If provided, reuse pool threads (for backtest)

    def execute(
        self,
        code: str,
        market_data: MarketData,
        params: Dict[str, Any] = None,
    ) -> ExecutionResult:
        """Execute strategy code and return decision."""
        import time
        start_time = time.time()

        # Validate code first
        validation = validate_strategy_code(code)
        if not validation.is_valid:
            return ExecutionResult(
                success=False,
                decision=None,
                error=f"Validation failed: {'; '.join(validation.errors)}",
                execution_time_ms=0,
            )

        # Use threading for timeout (works in any thread, unlike signal.SIGALRM)
        result_holder = {"decision": None, "error": None}

        def run_sandbox():
            try:
                result_holder["decision"] = self._execute_in_sandbox(code, market_data, params or {})
            except ExecutionTimeoutError:
                result_holder["error"] = f"Execution timed out after {self.timeout_seconds}s"
            except Exception as e:
                result_holder["error"] = f"Execution error: {str(e)}\n{traceback.format_exc()}"

        if self._thread_pool:
            # Backtest mode: reuse pool thread to avoid thread creation overhead
            future = self._thread_pool.submit(run_sandbox)
            try:
                future.result(timeout=self.timeout_seconds)
            except Exception:
                # Timeout or other error - future may still be running
                pass
        else:
            # Real-time mode: create dedicated thread (no concurrency limit)
            execution_thread = threading.Thread(target=run_sandbox, daemon=True)
            execution_thread.start()
            execution_thread.join(timeout=self.timeout_seconds)

            if execution_thread.is_alive():
                # Thread still running - try to interrupt it
                _raise_timeout_in_thread(execution_thread.ident)
                execution_thread.join(timeout=0.5)
                return ExecutionResult(
                    success=False,
                    decision=None,
                    error=f"Execution timed out after {self.timeout_seconds}s",
                    execution_time_ms=self.timeout_seconds * 1000,
                    logs=self._execution_logs,
                )

        execution_time = (time.time() - start_time) * 1000

        if result_holder["error"]:
            return ExecutionResult(
                success=False,
                decision=None,
                error=result_holder["error"],
                execution_time_ms=execution_time,
                logs=self._execution_logs,
            )

        return ExecutionResult(
            success=True,
            decision=result_holder["decision"],
            error=None,
            execution_time_ms=execution_time,
            logs=self._execution_logs,
        )

    def _execute_in_sandbox(
        self,
        code: str,
        market_data: MarketData,
        params: Dict[str, Any],
    ) -> Decision:
        """Execute code in restricted namespace."""
        self._execution_logs = []

        # Build restricted globals
        restricted_globals = {
            "__builtins__": SAFE_BUILTINS,
            "math": type("math", (), SAFE_MATH)(),
            "time": type("time", (), SAFE_TIME)(),
            "MarketData": MarketData,
            "Decision": Decision,
            "ActionType": ActionType,
            "log": self._log,
        }

        # Execute code to define the class
        exec(code, restricted_globals)

        # Find the strategy class
        strategy_class = None
        for name, obj in restricted_globals.items():
            if isinstance(obj, type) and name not in ("MarketData", "Decision", "ActionType"):
                # Check if it has should_trade method
                if hasattr(obj, "should_trade"):
                    strategy_class = obj
                    break

        if not strategy_class:
            raise ValueError("No valid strategy class found in code")

        # Instantiate and run
        strategy = strategy_class()
        if hasattr(strategy, "init"):
            strategy.init(params)

        decision = strategy.should_trade(market_data)

        # Ensure decision is valid
        if not isinstance(decision, Decision):
            raise ValueError(f"should_trade must return Decision, got {type(decision)}")

        return decision

    def _log(self, message: str):
        """Log function available to strategies."""
        self._execution_logs.append(str(message))

    def get_logs(self) -> list:
        """Get execution logs."""
        return self._execution_logs.copy()


def validate_decision(decision: Decision, positions: Dict[str, Any] = None) -> tuple:
    """
    Validate Decision object fields according to output_format rules.

    Returns:
        (is_valid: bool, errors: list[str])
    """
    errors = []
    op = decision.operation.lower() if decision.operation else ""

    # Check operation is valid
    if op not in ("buy", "sell", "hold", "close"):
        errors.append(f"Invalid operation: '{decision.operation}'. Must be buy/sell/hold/close")
        return False, errors

    # For hold, minimal validation
    if op == "hold":
        return True, []

    # For buy/sell/close, check required fields
    if decision.target_portion_of_balance < 0.1 or decision.target_portion_of_balance > 1.0:
        errors.append(f"target_portion_of_balance must be 0.1-1.0, got {decision.target_portion_of_balance}")

    if decision.leverage < 1 or decision.leverage > 50:
        errors.append(f"leverage must be 1-50, got {decision.leverage}")

    # Price requirements based on operation
    if op == "buy":
        if decision.max_price is None:
            errors.append("max_price is required for buy operations")
    elif op == "sell":
        if decision.min_price is None:
            errors.append("min_price is required for sell operations")
    elif op == "close":
        # For close, need to check position side
        pos = positions.get(decision.symbol) if positions else None
        if pos:
            if pos.get("side") == "long" and decision.min_price is None:
                errors.append("min_price is required for closing LONG positions")
            elif pos.get("side") == "short" and decision.max_price is None:
                errors.append("max_price is required for closing SHORT positions")

    # Validate time_in_force
    if decision.time_in_force not in ("Ioc", "Gtc", "Alo"):
        errors.append(f"time_in_force must be Ioc/Gtc/Alo, got {decision.time_in_force}")

    # Validate execution modes
    if decision.tp_execution not in ("market", "limit"):
        errors.append(f"tp_execution must be market/limit, got {decision.tp_execution}")
    if decision.sl_execution not in ("market", "limit"):
        errors.append(f"sl_execution must be market/limit, got {decision.sl_execution}")

    return len(errors) == 0, errors


def validate_tp_sl_prices(
    operation: str,
    entry_price: float,
    take_profit_price: float = None,
    stop_loss_price: float = None,
) -> tuple:
    """
    Validate TP/SL prices against entry price and trade direction.
    Shared by both live trading and backtesting.

    Rules enforced (same as exchange-level rejection):
    - TP/SL must be positive
    - BUY (long): TP > entry, SL < entry
    - SELL (short): TP < entry, SL > entry
    - TP != SL when both are set
    - TP/SL != entry price

    Returns:
        (is_valid: bool, errors: list[str])
    """
    errors = []
    op = operation.lower()

    if op not in ("buy", "sell"):
        return True, []

    if take_profit_price is not None:
        if take_profit_price <= 0:
            errors.append(
                f"take_profit_price must be positive, got {take_profit_price}"
            )
        elif take_profit_price == entry_price:
            errors.append(
                f"take_profit_price ({take_profit_price}) cannot equal "
                f"entry price ({entry_price})"
            )
        elif op == "buy" and take_profit_price <= entry_price:
            errors.append(
                f"BUY/LONG: take_profit_price ({take_profit_price}) must be "
                f"above entry price ({entry_price})"
            )
        elif op == "sell" and take_profit_price >= entry_price:
            errors.append(
                f"SELL/SHORT: take_profit_price ({take_profit_price}) must be "
                f"below entry price ({entry_price})"
            )

    if stop_loss_price is not None:
        if stop_loss_price <= 0:
            errors.append(
                f"stop_loss_price must be positive, got {stop_loss_price}"
            )
        elif stop_loss_price == entry_price:
            errors.append(
                f"stop_loss_price ({stop_loss_price}) cannot equal "
                f"entry price ({entry_price})"
            )
        elif op == "buy" and stop_loss_price >= entry_price:
            errors.append(
                f"BUY/LONG: stop_loss_price ({stop_loss_price}) must be "
                f"below entry price ({entry_price})"
            )
        elif op == "sell" and stop_loss_price <= entry_price:
            errors.append(
                f"SELL/SHORT: stop_loss_price ({stop_loss_price}) must be "
                f"above entry price ({entry_price})"
            )

    if (take_profit_price is not None and stop_loss_price is not None
            and take_profit_price == stop_loss_price):
        errors.append(
            f"take_profit_price and stop_loss_price cannot be equal "
            f"({take_profit_price})"
        )

    return len(errors) == 0, errors


# Global thread pool for real-time program execution (prevents unbounded thread creation)
_realtime_thread_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="program-rt")


def execute_strategy(
    code: str,
    market_data: MarketData,
    params: Dict[str, Any] = None,
    timeout_seconds: int = 60,
) -> ExecutionResult:
    """Convenience function to execute strategy code."""
    executor = SandboxExecutor(timeout_seconds=timeout_seconds, thread_pool=_realtime_thread_pool)
    return executor.execute(code, market_data, params)
