"""
Program Backtest Engine

Event-driven backtest engine for Program Trader strategies.
Orchestrates trigger generation, strategy execution, and result calculation.
"""

import logging
import time
from typing import Dict, List, Any, Optional
from datetime import datetime, timezone
from sqlalchemy.orm import Session

from .models import BacktestConfig, TriggerEvent, BacktestResult, BacktestTradeRecord, TriggerExecutionResult
from .virtual_account import VirtualAccount
from .execution_simulator import ExecutionSimulator
from .historical_data_provider import HistoricalDataProvider

logger = logging.getLogger(__name__)

# Interval to milliseconds mapping
INTERVAL_MS = {
    "1m": 60 * 1000,
    "5m": 5 * 60 * 1000,
    "15m": 15 * 60 * 1000,
    "30m": 30 * 60 * 1000,
    "1h": 60 * 60 * 1000,
    "4h": 4 * 60 * 60 * 1000,
    "1d": 24 * 60 * 60 * 1000,
}


class ProgramBacktestEngine:
    """
    Event-driven backtest engine for Program Trader.

    Flow:
    1. Generate trigger events (signal + scheduled)
    2. Sort events by timestamp
    3. For each event:
       - Set historical data provider time
       - Check TP/SL triggers
       - Build MarketData
       - Execute strategy code
       - Simulate order execution
       - Update virtual account
    4. Calculate statistics
    """

    def __init__(self, db: Session):
        self.db = db

    def run(self, config: BacktestConfig) -> BacktestResult:
        """
        Run backtest with given configuration.

        Args:
            config: Backtest configuration

        Returns:
            BacktestResult with statistics and trade history
        """
        start_time = time.time()

        try:
            # 1. Generate signal trigger events (scheduled triggers are dynamic)
            signal_triggers = self._generate_trigger_events(config)

            # Allow backtest even with no signal triggers if scheduled triggers are enabled
            if not signal_triggers and not config.scheduled_interval_sec:
                return BacktestResult(
                    success=False,
                    error="No trigger events generated. Check signal pools and time range."
                )

            # 2. Initialize components
            account = VirtualAccount(initial_balance=config.initial_balance)
            simulator = ExecutionSimulator(
                slippage_percent=config.slippage_percent,
                fee_rate=config.fee_rate,
            )
            data_provider = HistoricalDataProvider(
                db=self.db,
                symbols=config.symbols,
                start_time_ms=config.start_time_ms,
                end_time_ms=config.end_time_ms,
                exchange=config.exchange,
            )

            # 3. Run event loop (returns all triggers including dynamic scheduled ones)
            trades, equity_curve, all_triggers = self._run_event_loop(
                config, signal_triggers, account, simulator, data_provider
            )

            # 4. Calculate statistics
            result = self._calculate_result(
                trades=trades,
                equity_curve=equity_curve,
                triggers=all_triggers,
                account=account,
                config=config,
            )
            result.execution_time_ms = (time.time() - start_time) * 1000

            return result

        except Exception as e:
            logger.error(f"Backtest failed: {e}", exc_info=True)
            return BacktestResult(
                success=False,
                error=str(e),
                execution_time_ms=(time.time() - start_time) * 1000,
            )

    def _generate_trigger_events(self, config: BacktestConfig) -> List[TriggerEvent]:
        """Generate signal trigger events only. Scheduled triggers are handled dynamically."""
        from services.signal_backtest_service import signal_backtest_service
        from services.market_regime_service import get_market_regime

        events = []

        # Generate signal triggers
        for pool_id in config.signal_pool_ids:
            for symbol in config.symbols:
                try:
                    pool_result = signal_backtest_service.backtest_pool(
                        self.db, pool_id, symbol,
                        config.start_time_ms, config.end_time_ms
                    )

                    if "error" in pool_result:
                        logger.warning(f"Signal backtest error for pool {pool_id}: {pool_result['error']}")
                        continue

                    for t in pool_result.get("triggers", []):
                        # Get market regime at trigger time
                        regime_data = None
                        try:
                            regime_result = get_market_regime(
                                self.db, symbol, "5m",
                                use_realtime=True,
                                timestamp_ms=t["timestamp"],
                                exchange=config.exchange
                            )
                            if regime_result:
                                regime_data = {
                                    "regime": regime_result.get("regime", "noise"),
                                    "conf": regime_result.get("confidence", 0.0),
                                    "direction": regime_result.get("direction", "neutral"),
                                    "reason": regime_result.get("reason", ""),
                                    "indicators": regime_result.get("indicators", {}),
                                }
                        except Exception as e:
                            logger.debug(f"Failed to get regime at {t['timestamp']}: {e}")

                        events.append(TriggerEvent(
                            timestamp=t["timestamp"],
                            trigger_type="signal",
                            symbol=symbol,
                            pool_id=pool_id,
                            pool_name=pool_result.get("pool_name"),
                            pool_logic=pool_result.get("logic"),
                            triggered_signals=t.get("triggered_signals", []),
                            market_regime=regime_data,
                        ))
                except Exception as e:
                    logger.error(f"Failed to get signal triggers for pool {pool_id}: {e}")

        # Sort by timestamp
        events.sort(key=lambda e: e.timestamp)

        # Log signal triggers count (scheduled triggers are dynamic)
        logger.info(f"Generated {len(events)} signal trigger events")

        return events

    def _run_event_loop(
        self,
        config: BacktestConfig,
        signal_triggers: List[TriggerEvent],
        account: VirtualAccount,
        simulator: ExecutionSimulator,
        data_provider: HistoricalDataProvider,
    ) -> tuple:
        """
        Run the main event loop with dynamic scheduled trigger generation.

        Signal triggers have higher priority. Each trigger (signal or scheduled)
        resets the scheduled trigger timer, matching real-time execution behavior.
        """
        from program_trader.executor import SandboxExecutor
        from concurrent.futures import ThreadPoolExecutor

        backtest_thread_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="backtest")
        executor = SandboxExecutor(timeout_seconds=5, thread_pool=backtest_thread_pool)
        trades: List[BacktestTradeRecord] = []
        equity_curve: List[Dict[str, Any]] = []
        all_triggers: List[TriggerEvent] = []  # Track all triggers for logging

        # Scheduled trigger state - now uses seconds directly
        scheduled_interval_ms = None
        if config.scheduled_interval_sec:
            scheduled_interval_ms = config.scheduled_interval_sec * 1000

        # Initialize: next scheduled trigger is start_time + interval
        last_trigger_time = config.start_time_ms

        def execute_trigger(trigger: TriggerEvent) -> int:
            """Execute a single trigger and return the trigger timestamp."""
            nonlocal last_trigger_time

            all_triggers.append(trigger)

            # Set current time
            data_provider.set_current_time(trigger.timestamp)

            # Get current prices
            prices = data_provider.get_current_prices(config.symbols)
            if not prices:
                return trigger.timestamp

            # Check TP/SL triggers first
            tp_sl_trades = simulator.check_tp_sl_triggers(account, prices, trigger.timestamp)
            trades.extend(tp_sl_trades)

            # Update equity after TP/SL
            account.update_equity(prices)

            # Determine trigger symbol
            trigger_symbol = trigger.symbol if trigger.symbol else config.symbols[0]

            # Build MarketData for strategy (pass trades for recent_trades)
            market_data = self._build_market_data(
                account, data_provider, trigger, trigger_symbol, trades
            )

            # Execute strategy
            result = executor.execute(config.code, market_data, {})

            if result.success and result.decision:
                decision = result.decision
                symbol = decision.symbol or trigger_symbol
                current_price = prices.get(symbol, 0)

                if current_price > 0:
                    # Get signal names for logging
                    signal_names = [
                        s.get("signal_name", "") for s in (trigger.triggered_signals or [])
                    ]

                    trade = simulator.execute_decision(
                        decision=decision,
                        account=account,
                        current_price=current_price,
                        timestamp=trigger.timestamp,
                        trigger_type=trigger.trigger_type,
                        pool_name=trigger.pool_name,
                        triggered_signals=signal_names,
                    )
                    if trade:
                        trades.append(trade)

            # Update equity and record
            account.update_equity(prices)
            equity_curve.append({
                "timestamp": trigger.timestamp,
                "equity": account.equity,
                "balance": account.balance,
                "drawdown": account.max_drawdown,
            })

            return trigger.timestamp

        # Process signal triggers with dynamic scheduled triggers
        for signal_trigger in signal_triggers:
            # Before processing this signal, check if scheduled triggers should fire
            if scheduled_interval_ms:
                next_scheduled_time = last_trigger_time + scheduled_interval_ms
                while next_scheduled_time < signal_trigger.timestamp:
                    # Fire scheduled trigger
                    scheduled_trigger = TriggerEvent(
                        timestamp=next_scheduled_time,
                        trigger_type="scheduled",
                        symbol="",
                    )
                    last_trigger_time = execute_trigger(scheduled_trigger)
                    next_scheduled_time = last_trigger_time + scheduled_interval_ms

            # Process signal trigger (resets scheduled timer)
            last_trigger_time = execute_trigger(signal_trigger)

        # After all signal triggers, continue with remaining scheduled triggers until end_time
        if scheduled_interval_ms:
            next_scheduled_time = last_trigger_time + scheduled_interval_ms
            while next_scheduled_time <= config.end_time_ms:
                scheduled_trigger = TriggerEvent(
                    timestamp=next_scheduled_time,
                    trigger_type="scheduled",
                    symbol="",
                )
                last_trigger_time = execute_trigger(scheduled_trigger)
                next_scheduled_time = last_trigger_time + scheduled_interval_ms

        # Log final trigger counts
        signal_count = sum(1 for t in all_triggers if t.trigger_type == "signal")
        scheduled_count = sum(1 for t in all_triggers if t.trigger_type == "scheduled")
        logger.info(f"Executed {len(all_triggers)} triggers "
                   f"({signal_count} signal, {scheduled_count} scheduled)")

        backtest_thread_pool.shutdown(wait=False)
        return trades, equity_curve, all_triggers

    def estimate_total_triggers(
        self,
        config: BacktestConfig,
        signal_triggers: List[TriggerEvent],
    ) -> int:
        """
        Estimate total trigger count including dynamic scheduled triggers.
        Uses same algorithm as run_event_loop_generator but only counts.
        """
        if not config.scheduled_interval_sec:
            return len(signal_triggers)

        scheduled_interval_ms = config.scheduled_interval_sec * 1000
        total = 0
        last_trigger_time = config.start_time_ms

        for signal_trigger in signal_triggers:
            # Count scheduled triggers before this signal
            next_scheduled_time = last_trigger_time + scheduled_interval_ms
            while next_scheduled_time < signal_trigger.timestamp:
                total += 1
                last_trigger_time = next_scheduled_time
                next_scheduled_time = last_trigger_time + scheduled_interval_ms
            # Count signal trigger
            total += 1
            last_trigger_time = signal_trigger.timestamp

        # Count remaining scheduled triggers
        next_scheduled_time = last_trigger_time + scheduled_interval_ms
        while next_scheduled_time <= config.end_time_ms:
            total += 1
            last_trigger_time = next_scheduled_time
            next_scheduled_time = last_trigger_time + scheduled_interval_ms

        return total

    def run_event_loop_generator(
        self,
        config: BacktestConfig,
        signal_triggers: List[TriggerEvent],
        account: VirtualAccount,
        simulator: ExecutionSimulator,
        data_provider: HistoricalDataProvider,
    ):
        """
        Generator version of event loop for streaming progress.

        Yields TriggerExecutionResult for each trigger (signal or scheduled).
        Handles dynamic scheduled trigger generation with timer reset.
        """
        from program_trader.executor import SandboxExecutor
        from concurrent.futures import ThreadPoolExecutor

        backtest_thread_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="backtest")
        executor = SandboxExecutor(timeout_seconds=5, thread_pool=backtest_thread_pool)

        try:
            yield from self._run_generator_body(
                config, signal_triggers, account, simulator, data_provider, executor
            )
        finally:
            backtest_thread_pool.shutdown(wait=False)

    def _run_generator_body(
        self,
        config: BacktestConfig,
        signal_triggers: List[TriggerEvent],
        account: VirtualAccount,
        simulator: ExecutionSimulator,
        data_provider: HistoricalDataProvider,
        executor,
    ):
        """Inner generator body for run_event_loop_generator."""
        all_trades: List[BacktestTradeRecord] = []

        # Scheduled trigger state - now uses seconds directly
        scheduled_interval_ms = None
        if config.scheduled_interval_sec:
            scheduled_interval_ms = config.scheduled_interval_sec * 1000

        last_trigger_time = config.start_time_ms

        def check_tp_sl_between_triggers(
            last_time_ms: int,
            current_time_ms: int,
        ) -> List[BacktestTradeRecord]:
            """Check TP/SL using 1m kline high/low for maximum accuracy."""
            all_tp_sl_trades = []

            # Get 1m klines between triggers for each symbol with positions
            for symbol in config.symbols:
                pos = account.get_position(symbol)
                if not pos:
                    continue

                # Use 1m klines for precise TP/SL detection
                klines = data_provider.get_klines_between(
                    symbol, last_time_ms, current_time_ms, "1m"
                )

                if klines:
                    trades = simulator.check_tp_sl_with_klines(
                        account, klines, pos.side, data_provider
                    )
                    all_tp_sl_trades.extend(trades)

            # Sort by exit timestamp
            all_tp_sl_trades.sort(key=lambda t: t.exit_timestamp or 0)
            return all_tp_sl_trades

        def execute_single_trigger(
            trigger: TriggerEvent,
            prev_trigger_time: int,
        ) -> TriggerExecutionResult:
            """Execute a single trigger and return result."""
            equity_before = account.equity

            # Set current time and clear query log
            data_provider.set_current_time(trigger.timestamp)
            data_provider.clear_query_log()

            # Get current prices
            prices = data_provider.get_current_prices(config.symbols)
            if not prices:
                return TriggerExecutionResult(
                    trigger=trigger,
                    trigger_symbol=config.symbols[0] if config.symbols else "",
                    prices={},
                    executor_result=None,
                    trade=None,
                    tp_sl_trades=[],
                    equity_before=equity_before,
                    equity_after=equity_before,
                    equity_after_tp_sl=equity_before,
                    unrealized_pnl=0,
                    data_queries=[],
                )

            # Check TP/SL using kline high/low between triggers (more accurate)
            tp_sl_trades = check_tp_sl_between_triggers(prev_trigger_time, trigger.timestamp)

            # Update equity after TP/SL and record it
            account.update_equity(prices)
            equity_after_tp_sl = account.equity

            # Determine trigger symbol
            trigger_symbol = trigger.symbol if trigger.symbol else config.symbols[0]

            # Snapshot account state BEFORE strategy execution (for logging)
            balance_before = account.balance
            positions_before = {
                k: {
                    "side": v.side,
                    "size": v.size,
                    "entry_price": v.entry_price,
                    "opened_at": v.entry_timestamp,
                }
                for k, v in account.positions.items()
            }
            used_margin_before = account.get_used_margin()
            margin_usage_percent_before = account.get_margin_usage_percent()

            # Build MarketData for strategy (pass all_trades for recent_trades)
            market_data = self._build_market_data(
                account, data_provider, trigger, trigger_symbol, all_trades
            )

            # Execute strategy
            result = executor.execute(config.code, market_data, {})

            trade = None
            if result.success and result.decision:
                decision = result.decision
                symbol = decision.symbol or trigger_symbol
                current_price = prices.get(symbol, 0)

                if current_price > 0 and decision.operation != "hold":
                    signal_names = [
                        s.get("signal_name", "") for s in (trigger.triggered_signals or [])
                    ]
                    trade = simulator.execute_decision(
                        decision=decision,
                        account=account,
                        current_price=current_price,
                        timestamp=trigger.timestamp,
                        trigger_type=trigger.trigger_type,
                        pool_name=trigger.pool_name,
                        triggered_signals=signal_names,
                    )
                    if trade:
                        all_trades.append(trade)

            # Track TP/SL trades
            for tp_sl_trade in tp_sl_trades:
                all_trades.append(tp_sl_trade)

            # Update equity
            account.update_equity(prices)

            return TriggerExecutionResult(
                trigger=trigger,
                trigger_symbol=trigger_symbol,
                prices=prices,
                executor_result=result,
                trade=trade,
                tp_sl_trades=tp_sl_trades,
                equity_before=equity_before,
                equity_after=account.equity,
                equity_after_tp_sl=equity_after_tp_sl,
                unrealized_pnl=account.unrealized_pnl_total,
                balance_before=balance_before,
                positions_before=positions_before,
                used_margin_before=used_margin_before,
                margin_usage_percent_before=margin_usage_percent_before,
                data_queries=data_provider.get_query_log(),
            )

        # Process signal triggers with dynamic scheduled triggers
        for signal_trigger in signal_triggers:
            # Before processing this signal, fire any pending scheduled triggers
            if scheduled_interval_ms:
                next_scheduled_time = last_trigger_time + scheduled_interval_ms
                while next_scheduled_time < signal_trigger.timestamp:
                    scheduled_trigger = TriggerEvent(
                        timestamp=next_scheduled_time,
                        trigger_type="scheduled",
                        symbol="",
                    )
                    exec_result = execute_single_trigger(scheduled_trigger, last_trigger_time)
                    last_trigger_time = scheduled_trigger.timestamp
                    yield exec_result
                    next_scheduled_time = last_trigger_time + scheduled_interval_ms

            # Process signal trigger (resets scheduled timer)
            exec_result = execute_single_trigger(signal_trigger, last_trigger_time)
            last_trigger_time = signal_trigger.timestamp
            yield exec_result

        # After all signal triggers, continue with remaining scheduled triggers
        if scheduled_interval_ms:
            next_scheduled_time = last_trigger_time + scheduled_interval_ms
            while next_scheduled_time <= config.end_time_ms:
                scheduled_trigger = TriggerEvent(
                    timestamp=next_scheduled_time,
                    trigger_type="scheduled",
                    symbol="",
                )
                exec_result = execute_single_trigger(scheduled_trigger, last_trigger_time)
                last_trigger_time = scheduled_trigger.timestamp
                yield exec_result
                next_scheduled_time = last_trigger_time + scheduled_interval_ms

    def _build_market_data(
        self,
        account: VirtualAccount,
        data_provider: HistoricalDataProvider,
        trigger: TriggerEvent,
        trigger_symbol: str,
        recent_trades: List[BacktestTradeRecord] = None,
    ) -> Any:
        """Build MarketData object for strategy execution."""
        from program_trader.models import MarketData, Position, Trade
        from datetime import datetime, timezone

        # Convert virtual positions to Position objects
        positions = {}
        current_time_ms = trigger.timestamp  # Use trigger timestamp as current time in backtest
        for symbol, vpos in account.positions.items():
            # Calculate position timing information
            opened_at = vpos.entry_timestamp if vpos.entry_timestamp else None
            opened_at_str = None
            holding_duration_seconds = None
            holding_duration_str = None

            if opened_at and opened_at > 0:
                # Format opened_at as UTC string
                utc_dt = datetime.fromtimestamp(opened_at / 1000, tz=timezone.utc)
                opened_at_str = utc_dt.strftime('%Y-%m-%d %H:%M:%S UTC')

                # Calculate holding duration
                holding_duration_seconds = (current_time_ms - opened_at) / 1000
                hours = int(holding_duration_seconds // 3600)
                minutes = int((holding_duration_seconds % 3600) // 60)
                if hours > 0:
                    holding_duration_str = f"{hours}h {minutes}m"
                else:
                    holding_duration_str = f"{minutes}m"

            positions[symbol] = Position(
                symbol=symbol,
                side=vpos.side,
                size=vpos.size,
                entry_price=vpos.entry_price,
                unrealized_pnl=vpos.unrealized_pnl,
                leverage=vpos.leverage,
                liquidation_price=0,
                opened_at=opened_at,
                opened_at_str=opened_at_str,
                holding_duration_seconds=holding_duration_seconds,
                holding_duration_str=holding_duration_str,
            )

        # Convert recent trades to Trade objects (last 20 closed trades)
        trade_objects = []
        if recent_trades:
            closed_trades = [t for t in recent_trades if t.exit_price is not None][-20:]
            for t in closed_trades:
                trade_objects.append(Trade(
                    symbol=t.symbol,
                    side=t.side.capitalize(),  # "long" -> "Long"
                    size=t.size,
                    price=t.entry_price,
                    timestamp=t.timestamp,
                    pnl=t.pnl,
                ))

        # Build triggered signals info - pass through ALL fields from backtest service
        # Strategy code needs: metric, current_value, direction, ratio, threshold, etc.
        triggered_signals = []
        if trigger.triggered_signals:
            for sig in trigger.triggered_signals:
                # Pass through all signal data as-is
                signal_data = dict(sig)  # Copy all fields
                # Ensure current_value is set (backtest service uses 'value')
                if "current_value" not in signal_data and "value" in signal_data:
                    signal_data["current_value"] = signal_data["value"]
                triggered_signals.append(signal_data)

        # Build trigger_market_regime from trigger.market_regime
        trigger_market_regime = None
        if trigger.market_regime:
            from program_trader.models import RegimeInfo
            mr = trigger.market_regime
            trigger_market_regime = RegimeInfo(
                regime=mr.get("regime", "noise"),
                conf=mr.get("conf", 0.0),
                direction=mr.get("direction", "neutral"),
                reason=mr.get("reason", ""),
                indicators=mr.get("indicators", {}),
            )

        return MarketData(
            available_balance=account.balance,
            total_equity=account.equity,
            used_margin=account.get_used_margin(),
            margin_usage_percent=account.get_margin_usage_percent(),
            maintenance_margin=account.get_maintenance_margin(),
            trigger_symbol=trigger_symbol,
            trigger_type=trigger.trigger_type,
            positions=positions,
            recent_trades=trade_objects,
            # Trigger context (detailed)
            signal_pool_name=trigger.pool_name or "",
            pool_logic=trigger.pool_logic or "OR",
            triggered_signals=triggered_signals,
            trigger_market_regime=trigger_market_regime,
            _data_provider=data_provider,
        )

    def _calculate_result(
        self,
        trades: List[BacktestTradeRecord],
        equity_curve: List[Dict[str, Any]],
        triggers: List[TriggerEvent],
        account: VirtualAccount,
        config: BacktestConfig,
    ) -> BacktestResult:
        """Calculate backtest statistics."""
        # Filter closed trades (with exit_price)
        closed_trades = [t for t in trades if t.exit_price is not None]

        # Basic counts
        total_trades = len(closed_trades)
        winning_trades = [t for t in closed_trades if t.pnl > 0]
        losing_trades = [t for t in closed_trades if t.pnl <= 0]

        # PnL calculations
        total_pnl = sum(t.pnl for t in closed_trades)
        total_pnl_percent = (total_pnl / config.initial_balance * 100) if config.initial_balance > 0 else 0

        # Win rate
        win_rate = (len(winning_trades) / total_trades * 100) if total_trades > 0 else 0

        # Profit factor
        total_profit = sum(t.pnl for t in winning_trades)
        total_loss = abs(sum(t.pnl for t in losing_trades))
        # When total_loss is 0, profit_factor is undefined (use None to avoid JSON Infinity issue)
        profit_factor = (total_profit / total_loss) if total_loss > 0 else None

        # Average win/loss
        avg_win = (total_profit / len(winning_trades)) if winning_trades else 0
        avg_loss = (total_loss / len(losing_trades)) if losing_trades else 0

        # Largest win/loss
        largest_win = max((t.pnl for t in winning_trades), default=0)
        largest_loss = min((t.pnl for t in losing_trades), default=0)

        # Trigger counts
        signal_triggers = sum(1 for t in triggers if t.trigger_type == "signal")
        scheduled_triggers = sum(1 for t in triggers if t.trigger_type == "scheduled")

        # Sharpe ratio (simplified - annualized)
        sharpe_ratio = 0.0
        if equity_curve and len(equity_curve) > 1:
            returns = []
            for i in range(1, len(equity_curve)):
                prev_eq = equity_curve[i-1]["equity"]
                curr_eq = equity_curve[i]["equity"]
                if prev_eq > 0:
                    returns.append((curr_eq - prev_eq) / prev_eq)

            if returns:
                import statistics
                mean_return = statistics.mean(returns)
                std_return = statistics.stdev(returns) if len(returns) > 1 else 0
                if std_return > 0:
                    # Annualize (assume daily returns, 252 trading days)
                    sharpe_ratio = (mean_return / std_return) * (252 ** 0.5)

        return BacktestResult(
            success=True,
            total_pnl=total_pnl,
            total_pnl_percent=total_pnl_percent,
            max_drawdown=account.max_drawdown,
            max_drawdown_percent=account.max_drawdown_percent * 100,
            sharpe_ratio=sharpe_ratio,
            total_trades=total_trades,
            winning_trades=len(winning_trades),
            losing_trades=len(losing_trades),
            win_rate=win_rate,
            profit_factor=profit_factor,
            avg_win=avg_win,
            avg_loss=avg_loss,
            largest_win=largest_win,
            largest_loss=largest_loss,
            total_triggers=len(triggers),
            signal_triggers=signal_triggers,
            scheduled_triggers=scheduled_triggers,
            equity_curve=equity_curve,
            trades=trades,
            trigger_log=triggers,
            start_time=config.start_time,
            end_time=config.end_time,
        )

