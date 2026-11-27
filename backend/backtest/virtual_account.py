"""
Virtual Account for Backtest

Manages virtual account state during backtesting:
- Balance and equity tracking
- Position management
- Pending orders (TP/SL)
"""

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Any
from copy import deepcopy


@dataclass
class VirtualPosition:
    """Virtual position in backtest."""
    symbol: str
    side: str                              # "long" or "short"
    size: float                            # Position size in base currency
    entry_price: float
    leverage: int = 1
    entry_timestamp: int = 0

    # TP/SL settings
    take_profit_price: Optional[float] = None
    stop_loss_price: Optional[float] = None

    # Tracking
    unrealized_pnl: float = 0.0
    margin_used: float = 0.0

    def update_pnl(self, current_price: float) -> float:
        """Update and return unrealized PnL."""
        if self.side == "long":
            self.unrealized_pnl = (current_price - self.entry_price) * self.size
        else:
            self.unrealized_pnl = (self.entry_price - current_price) * self.size
        return self.unrealized_pnl

    def get_notional_value(self, current_price: float) -> float:
        """Get current notional value of position."""
        return self.size * current_price


@dataclass
class VirtualOrder:
    """Virtual pending order (TP/SL) - each order is independent like Hyperliquid."""
    order_id: int
    symbol: str
    side: str                              # "buy" or "sell"
    order_type: str                        # "take_profit", "stop_loss"
    trigger_price: float
    size: float                            # Size this order controls (independent)
    entry_price: float = 0.0               # Entry price when this order was created
    reduce_only: bool = True
    created_at: int = 0


class VirtualAccount:
    """
    Virtual account state manager for backtesting.

    Tracks balance, positions, and pending orders throughout
    the backtest simulation.

    Equity calculation (Account Value style):
    equity = initial_balance + realized_pnl_total + unrealized_pnl - total_fees

    This matches how Hyperliquid displays Account Value - margin is locked
    but doesn't reduce equity, only actual PnL and fees affect equity.
    """

    def __init__(self, initial_balance: float = 10000.0):
        self.initial_balance = initial_balance
        self.balance = initial_balance     # Available balance (for margin calculation)
        self.equity = initial_balance      # Account Value
        self.positions: Dict[str, VirtualPosition] = {}
        self.pending_orders: List[VirtualOrder] = []
        self._order_id_counter = 0

        # PnL tracking (Account Value style)
        self.realized_pnl_total = 0.0      # Cumulative realized PnL
        self.unrealized_pnl_total = 0.0    # Current unrealized PnL
        self.total_fees = 0.0              # Cumulative fees paid

        # Drawdown tracking
        self.peak_equity = initial_balance
        self.max_drawdown = 0.0
        self.max_drawdown_percent = 0.0

    def reset(self):
        """Reset account to initial state."""
        self.balance = self.initial_balance
        self.equity = self.initial_balance
        self.positions = {}
        self.pending_orders = []
        self._order_id_counter = 0
        self.realized_pnl_total = 0.0
        self.unrealized_pnl_total = 0.0
        self.total_fees = 0.0
        self.peak_equity = self.initial_balance
        self.max_drawdown = 0.0
        self.max_drawdown_percent = 0.0

    def update_equity(self, prices: Dict[str, float]):
        """Update equity and available balance based on current prices."""
        self.unrealized_pnl_total = 0.0
        for symbol, pos in self.positions.items():
            if symbol in prices:
                self.unrealized_pnl_total += pos.update_pnl(prices[symbol])

        # Account Value = initial + realized + unrealized - fees
        self.equity = self.initial_balance + self.realized_pnl_total + self.unrealized_pnl_total - self.total_fees

        # Available balance = equity - used_margin (matches Hyperliquid)
        self.balance = self.equity - self.get_used_margin()

        # Track drawdown
        if self.equity > self.peak_equity:
            self.peak_equity = self.equity

        if self.peak_equity > 0:
            current_drawdown = self.peak_equity - self.equity
            current_drawdown_pct = current_drawdown / self.peak_equity
            if current_drawdown > self.max_drawdown:
                self.max_drawdown = current_drawdown
                self.max_drawdown_percent = current_drawdown_pct

    def get_used_margin(self) -> float:
        """Calculate total used margin across all positions."""
        return sum(pos.margin_used for pos in self.positions.values())

    def get_margin_usage_percent(self) -> float:
        """Calculate margin usage as percentage of equity."""
        if self.equity <= 0:
            return 100.0
        used_margin = self.get_used_margin()
        return (used_margin / self.equity) * 100

    def get_maintenance_margin(self) -> float:
        """Calculate maintenance margin (simplified: 50% of used margin)."""
        return self.get_used_margin() * 0.5

    def open_position(
        self,
        symbol: str,
        side: str,
        size: float,
        entry_price: float,
        leverage: int = 1,
        timestamp: int = 0,
        take_profit: Optional[float] = None,
        stop_loss: Optional[float] = None,
        fee: float = 0.0,
    ) -> VirtualPosition:
        """Open a new position."""
        # Calculate margin required
        notional = size * entry_price
        margin_required = notional / leverage

        position = VirtualPosition(
            symbol=symbol,
            side=side,
            size=size,
            entry_price=entry_price,
            leverage=leverage,
            entry_timestamp=timestamp,
            take_profit_price=take_profit,
            stop_loss_price=stop_loss,
            margin_used=margin_required,
        )

        self.positions[symbol] = position
        # Note: balance is now calculated dynamically in update_equity()
        # as equity - used_margin, so no need to manually adjust here

        # Track fee (affects equity via total_fees)
        self.total_fees += fee

        return position

    def close_position(
        self,
        symbol: str,
        exit_price: float,
        fee: float = 0.0,
    ) -> Optional[float]:
        """Close position and return realized PnL (before fee deduction)."""
        if symbol not in self.positions:
            return None

        pos = self.positions[symbol]
        pos.update_pnl(exit_price)
        realized_pnl = pos.unrealized_pnl  # PnL before fee

        # Update cumulative tracking
        self.realized_pnl_total += realized_pnl
        self.total_fees += fee

        # Note: balance is now calculated dynamically in update_equity()
        # as equity - used_margin, so no need to manually adjust here

        # Remove position and related orders
        del self.positions[symbol]
        self.pending_orders = [o for o in self.pending_orders if o.symbol != symbol]

        return realized_pnl

    def add_to_position(
        self,
        symbol: str,
        size: float,
        entry_price: float,
        fee: float = 0.0,
        take_profit: Optional[float] = None,
        stop_loss: Optional[float] = None,
    ) -> Optional[VirtualPosition]:
        """
        Add to existing position (averaging entry price).

        Returns updated position or None if no existing position.
        """
        if symbol not in self.positions:
            return None

        pos = self.positions[symbol]

        # Calculate weighted average entry price
        old_notional = pos.size * pos.entry_price
        new_notional = size * entry_price
        total_size = pos.size + size
        avg_entry_price = (old_notional + new_notional) / total_size

        # Calculate additional margin required
        additional_margin = (size * entry_price) / pos.leverage

        # Update position
        pos.size = total_size
        pos.entry_price = avg_entry_price
        pos.margin_used += additional_margin

        # Update TP/SL if provided (override old values)
        if take_profit is not None:
            pos.take_profit_price = take_profit
        if stop_loss is not None:
            pos.stop_loss_price = stop_loss

        # Note: balance is now calculated dynamically in update_equity()
        self.total_fees += fee

        return pos

    def has_position(self, symbol: str) -> bool:
        """Check if position exists for symbol."""
        return symbol in self.positions

    def get_position(self, symbol: str) -> Optional[VirtualPosition]:
        """Get position for symbol."""
        return self.positions.get(symbol)

    def add_pending_order(
        self,
        symbol: str,
        side: str,
        order_type: str,
        trigger_price: float,
        size: float,
        entry_price: float = 0.0,
        timestamp: int = 0,
    ) -> VirtualOrder:
        """Add a pending order (TP/SL) - each order is independent."""
        self._order_id_counter += 1
        order = VirtualOrder(
            order_id=self._order_id_counter,
            symbol=symbol,
            side=side,
            order_type=order_type,
            trigger_price=trigger_price,
            size=size,
            entry_price=entry_price,
            created_at=timestamp,
        )
        self.pending_orders.append(order)
        return order

    def remove_pending_order(self, order_id: int):
        """Remove a pending order by ID."""
        self.pending_orders = [o for o in self.pending_orders if o.order_id != order_id]

    def partial_close_position(
        self,
        symbol: str,
        size: float,
        exit_price: float,
        fee: float = 0.0,
        entry_price: float = 0.0,
    ) -> Optional[float]:
        """
        Partially close a position and return realized PnL for the closed portion.

        Args:
            symbol: Trading symbol
            size: Size to close (must be <= position size)
            exit_price: Exit price
            fee: Trading fee
            entry_price: Entry price for this portion (for accurate PnL calculation)

        Returns:
            Realized PnL for the closed portion, or None if no position
        """
        if symbol not in self.positions:
            return None

        pos = self.positions[symbol]

        # Ensure we don't close more than we have
        close_size = min(size, pos.size)
        if close_size <= 0:
            return None

        # Calculate PnL for this portion using the specific entry price
        actual_entry = entry_price if entry_price > 0 else pos.entry_price
        if pos.side == "long":
            realized_pnl = (exit_price - actual_entry) * close_size
        else:
            realized_pnl = (actual_entry - exit_price) * close_size

        # Update cumulative tracking
        self.realized_pnl_total += realized_pnl
        self.total_fees += fee

        # Calculate margin to return (proportional to size closed)
        margin_to_return = (close_size / pos.size) * pos.margin_used

        # Update position
        remaining_size = pos.size - close_size
        if remaining_size <= 0.0001:  # Effectively zero, close entire position
            del self.positions[symbol]
            # Remove all pending orders for this symbol
            self.pending_orders = [o for o in self.pending_orders if o.symbol != symbol]
        else:
            # Update position with remaining size
            pos.margin_used -= margin_to_return
            pos.size = remaining_size

        # Note: balance is now calculated dynamically in update_equity()
        return realized_pnl

    def get_state_snapshot(self) -> Dict[str, Any]:
        """Get current account state as dict."""
        return {
            "balance": self.balance,
            "equity": self.equity,
            "positions": {
                s: {
                    "side": p.side,
                    "size": p.size,
                    "entry_price": p.entry_price,
                    "unrealized_pnl": p.unrealized_pnl,
                }
                for s, p in self.positions.items()
            },
            "pending_orders": len(self.pending_orders),
            "max_drawdown": self.max_drawdown,
            "max_drawdown_percent": self.max_drawdown_percent,
        }

