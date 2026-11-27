"""
Backtest Engine Module

Provides event-driven backtesting infrastructure for:
- Program Trader strategies
- AI Prompt strategies (future)

Core components:
- BacktestConfig: Backtest configuration
- TriggerEvent: Unified trigger event format
- BacktestResult: Backtest results and statistics
- VirtualAccount: Virtual account state management
- ExecutionSimulator: Order execution simulation
- HistoricalDataProvider: Historical data retrieval
- ProgramBacktestEngine: Main backtest engine
"""

from .models import (
    BacktestConfig,
    TriggerEvent,
    BacktestResult,
    BacktestTradeRecord,
    TriggerExecutionResult,
)
from .virtual_account import VirtualAccount
from .execution_simulator import ExecutionSimulator
from .historical_data_provider import HistoricalDataProvider
from .engine import ProgramBacktestEngine

__all__ = [
    "BacktestConfig",
    "TriggerEvent",
    "BacktestResult",
    "BacktestTradeRecord",
    "TriggerExecutionResult",
    "VirtualAccount",
    "ExecutionSimulator",
    "HistoricalDataProvider",
    "ProgramBacktestEngine",
]
