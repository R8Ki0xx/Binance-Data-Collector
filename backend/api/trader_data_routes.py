"""
Trader Data Export/Import API Routes
Export AI decision logs with related Hyperliquid trades for migration between environments.
"""

from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from typing import Optional, List, Tuple
from datetime import datetime, timezone
from decimal import Decimal
import json
import hashlib
import logging
from dateutil.parser import parse

from database.connection import SessionLocal
from database.snapshot_connection import SnapshotSessionLocal
from database.models import (
    Account, AIDecisionLog,
    AccountPromptBinding, AccountStrategyConfig,
    SignalTriggerLog
)
from database.snapshot_models import HyperliquidTrade

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/trader", tags=["trader-data"])

EXPORT_VERSION = "1.0"


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_snapshot_db():
    db = SnapshotSessionLocal()
    try:
        yield db
    finally:
        db.close()


def _decimal_to_float(obj):
    """Convert Decimal to float for JSON serialization."""
    if isinstance(obj, Decimal):
        return float(obj)
    raise TypeError(f"Object of type {type(obj)} is not JSON serializable")


def _serialize_datetime(dt) -> Optional[str]:
    """Serialize datetime to ISO format string."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def _get_related_trades(
    snapshot_db: Session,
    hyperliquid_order_id: Optional[str],
    tp_order_id: Optional[str],
    sl_order_id: Optional[str]
) -> List[dict]:
    """Query HyperliquidTrade records for main/tp/sl orders and mark order_type."""
    trades = []
    order_mappings = []

    if hyperliquid_order_id:
        order_mappings.append((hyperliquid_order_id, "main"))
    if tp_order_id:
        order_mappings.append((tp_order_id, "tp"))
    if sl_order_id:
        order_mappings.append((sl_order_id, "sl"))

    if not order_mappings:
        return trades

    order_ids = [oid for oid, _ in order_mappings]
    trade_records = snapshot_db.query(HyperliquidTrade).filter(
        HyperliquidTrade.order_id.in_(order_ids)
    ).all()

    # Build order_id to order_type mapping
    order_type_map = {oid: otype for oid, otype in order_mappings}

    for trade in trade_records:
        trades.append({
            "order_id": trade.order_id,
            "symbol": trade.symbol,
            "side": trade.side,
            "quantity": float(trade.quantity) if trade.quantity else 0,
            "price": float(trade.price) if trade.price else 0,
            "leverage": trade.leverage,
            "trade_value": float(trade.trade_value) if trade.trade_value else 0,
            "fee": float(trade.fee) if trade.fee else 0,
            "trade_time": _serialize_datetime(trade.trade_time),
            "order_type": order_type_map.get(trade.order_id, "unknown"),
            "environment": trade.environment,
            "wallet_address": trade.wallet_address
        })

    return trades


@router.get("/{account_id}/export")
async def export_trader_data(
    account_id: int,
    db: Session = Depends(get_db),
    snapshot_db: Session = Depends(get_snapshot_db)
):
    """
    Export all AI decision logs with related Hyperliquid trades for a trader.
    Returns a JSON file for download.
    """
    # Verify account exists
    account = db.query(Account).filter(Account.id == account_id, Account.is_deleted != True).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    # Query all decision logs for this account
    decision_logs = db.query(AIDecisionLog).filter(
        AIDecisionLog.account_id == account_id
    ).order_by(AIDecisionLog.decision_time.asc()).all()

    # Build export data
    export_data = {
        "version": EXPORT_VERSION,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "source": {
            "account_name": account.name,
            "account_id": account_id
        },
        "decision_logs": []
    }

    for log in decision_logs:
        log_data = {
            "original_id": log.id,
            "decision_time": _serialize_datetime(log.decision_time),
            "symbol": log.symbol,
            "operation": log.operation,
            "reason": log.reason,
            "prev_portion": float(log.prev_portion) if log.prev_portion else 0,
            "target_portion": float(log.target_portion) if log.target_portion else 0,
            "total_balance": float(log.total_balance) if log.total_balance else 0,
            "executed": log.executed,
            "prompt_snapshot": log.prompt_snapshot,
            "reasoning_snapshot": log.reasoning_snapshot,
            "decision_snapshot": log.decision_snapshot,
            "hyperliquid_environment": log.hyperliquid_environment,
            "wallet_address": log.wallet_address,
            "hyperliquid_order_id": log.hyperliquid_order_id,
            "tp_order_id": log.tp_order_id,
            "sl_order_id": log.sl_order_id,
            "realized_pnl": float(log.realized_pnl) if log.realized_pnl else None,
            "pnl_updated_at": _serialize_datetime(log.pnl_updated_at),
            "created_at": _serialize_datetime(log.created_at),
            # Fields for trigger type and prompt association
            "signal_trigger_id": log.signal_trigger_id,
            "prompt_template_id": log.prompt_template_id,
        }

        # Get related trades from snapshot database
        trades = _get_related_trades(
            snapshot_db,
            log.hyperliquid_order_id,
            log.tp_order_id,
            log.sl_order_id
        )
        log_data["trades"] = trades

        export_data["decision_logs"].append(log_data)

    # Return as JSON response with download headers
    filename = f"{account.name.replace(' ', '_')}_export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"

    return JSONResponse(
        content=export_data,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Type": "application/json"
        }
    )


# ============================================================================
# Import APIs
# ============================================================================

from pydantic import BaseModel
from typing import Dict, Any


class ImportPreviewRequest(BaseModel):
    data: Dict[str, Any]


class ImportExecuteRequest(BaseModel):
    data: Dict[str, Any]
    confirmed: bool = False


def _generate_dedup_key(decision_time: str, symbol: str, decision_snapshot: str) -> str:
    """Generate a unique key for deduplication."""
    content = f"{decision_time}|{symbol or ''}|{decision_snapshot or ''}"
    return hashlib.md5(content.encode()).hexdigest()


def _find_duplicate_log(db: Session, account_id: int, log_data: dict) -> bool:
    """Check if a similar decision log already exists."""
    from dateutil import parser as date_parser

    decision_time_str = log_data.get("decision_time") or log_data.get("created_at")
    if not decision_time_str:
        return False

    try:
        decision_time = date_parser.parse(decision_time_str)
        if decision_time.tzinfo:
            decision_time = decision_time.replace(tzinfo=None)
    except Exception:
        return False

    symbol = log_data.get("symbol")
    decision_snapshot = log_data.get("decision_snapshot")

    # Query for matching record
    query = db.query(AIDecisionLog).filter(
        AIDecisionLog.account_id == account_id,
        AIDecisionLog.decision_time == decision_time
    )

    if symbol:
        query = query.filter(AIDecisionLog.symbol == symbol)

    existing = query.first()
    if existing and existing.decision_snapshot == decision_snapshot:
        return True

    return False


def _find_duplicate_trade(snapshot_db: Session, order_id: str, trade_time: datetime) -> bool:
    """Check if a trade with same order_id and trade_time already exists."""
    existing = snapshot_db.query(HyperliquidTrade).filter(
        HyperliquidTrade.order_id == order_id,
        HyperliquidTrade.trade_time == trade_time
    ).first()
    return existing is not None


@router.post("/{account_id}/import/preview")
async def preview_import(
    account_id: int,
    request: ImportPreviewRequest,
    db: Session = Depends(get_db)
):
    """
    Preview import: analyze the data and return what will be imported/skipped.
    Also check if target account has prompt/signal bindings.
    """
    # Verify account exists
    account = db.query(Account).filter(Account.id == account_id, Account.is_deleted != True).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    data = request.data

    # Validate version
    if data.get("version") != EXPORT_VERSION:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported export version: {data.get('version')}"
        )

    decision_logs = data.get("decision_logs", [])

    # Check for duplicates
    will_import = []
    will_skip = []

    for log in decision_logs:
        # Check if similar record exists
        if _find_duplicate_log(db, account_id, log):
            will_skip.append({
                "decision_time": log.get("decision_time"),
                "symbol": log.get("symbol"),
                "operation": log.get("operation"),
                "reason": "Duplicate record exists"
            })
        else:
            will_import.append(log)

    # Check account bindings
    warnings = []
    prompt_binding = db.query(AccountPromptBinding).filter(
        AccountPromptBinding.account_id == account_id,
        AccountPromptBinding.is_deleted != True
    ).first()

    strategy_config = db.query(AccountStrategyConfig).filter(
        AccountStrategyConfig.account_id == account_id
    ).first()

    if not prompt_binding:
        warnings.append("Target AI Trader has no prompt template binding")
    if not strategy_config or not strategy_config.signal_pool_ids:
        warnings.append("Target AI Trader has no signal pool binding")

    # Count trades
    total_trades = sum(len(log.get("trades", [])) for log in will_import)

    return {
        "will_import": {
            "decision_logs": len(will_import),
            "trades": total_trades
        },
        "will_skip": {
            "count": len(will_skip),
            "details": will_skip[:10]  # Show first 10
        },
        "warnings": warnings,
        "target_account": {
            "id": account.id,
            "name": account.name,
            "has_prompt_binding": prompt_binding is not None,
            "has_signal_binding": strategy_config is not None and bool(strategy_config.signal_pool_ids)
        }
    }


@router.post("/{account_id}/import/execute")
async def execute_import(
    account_id: int,
    request: ImportExecuteRequest,
    db: Session = Depends(get_db),
    snapshot_db: Session = Depends(get_snapshot_db)
):
    """Execute the import: create decision logs and trades in both databases."""
    if not request.confirmed:
        raise HTTPException(status_code=400, detail="Import must be confirmed")

    # Verify target account exists
    account = db.query(Account).filter(Account.id == account_id, Account.is_deleted != True).first()
    if not account:
        raise HTTPException(status_code=404, detail="Target account not found")

    # Get target trader's bound prompt template for association
    prompt_binding = db.query(AccountPromptBinding).filter(
        AccountPromptBinding.account_id == account_id,
        AccountPromptBinding.is_deleted != True
    ).first()
    target_prompt_template_id = prompt_binding.prompt_template_id if prompt_binding else None

    # Get target trader's bound signal pool and find a trigger record for association
    target_signal_trigger_id = None
    strategy_config = db.query(AccountStrategyConfig).filter(
        AccountStrategyConfig.account_id == account_id
    ).first()
    if strategy_config and strategy_config.signal_pool_ids:
        # Parse signal_pool_ids (stored as JSON string like '[10]')
        try:
            pool_ids = json.loads(strategy_config.signal_pool_ids)
            if pool_ids and len(pool_ids) > 0:
                first_pool_id = pool_ids[0]
                # Find any trigger record from this pool
                trigger_record = db.query(SignalTriggerLog).filter(
                    SignalTriggerLog.pool_id == first_pool_id
                ).first()
                if trigger_record:
                    target_signal_trigger_id = trigger_record.id
        except (json.JSONDecodeError, TypeError):
            pass

    # Note: wallet_address will be taken from source trade data during import
    # Each trade record contains its original wallet_address

    # Parse import data
    try:
        data = json.loads(request.data) if isinstance(request.data, str) else request.data
        decision_logs = data.get("decision_logs", [])
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid JSON data: {str(e)}")

    # Import statistics
    imported_logs = 0
    imported_trades = 0
    skipped_logs = 0
    skipped_trades = 0
    errors = []

    try:
        for log_data in decision_logs:
            # Check for duplicate decision log
            decision_time = parse(log_data["decision_time"])
            symbol = log_data["symbol"]
            decision_snapshot = log_data.get("decision_snapshot")

            if _find_duplicate_log(db, account_id, {
                "decision_time": log_data["decision_time"],
                "symbol": symbol,
                "decision_snapshot": decision_snapshot
            }):
                skipped_logs += 1
                skipped_trades += len(log_data.get("trades", []))
                continue

            # Import decision log
            try:
                new_log = _import_decision_log(
                    db, account_id, log_data,
                    target_prompt_template_id, target_signal_trigger_id
                )
                imported_logs += 1

                # Import related trades
                for trade_data in log_data.get("trades", []):
                    try:
                        trade_time = parse(trade_data["trade_time"])
                        if _find_duplicate_trade(snapshot_db, trade_data["order_id"], trade_time):
                            skipped_trades += 1
                            continue

                        _import_trade(snapshot_db, account_id, trade_data)
                        imported_trades += 1
                    except Exception as e:
                        errors.append(f"Trade import error (order_id={trade_data.get('order_id')}): {str(e)}")
                        skipped_trades += 1

            except Exception as e:
                errors.append(f"Decision log import error (symbol={symbol}, time={log_data['decision_time']}): {str(e)}")
                skipped_logs += 1
                skipped_trades += len(log_data.get("trades", []))

        # Commit both databases
        db.commit()
        snapshot_db.commit()

    except Exception as e:
        db.rollback()
        snapshot_db.rollback()
        raise HTTPException(status_code=500, detail=f"Import failed: {str(e)}")

    return {
        "success": True,
        "imported": {
            "decision_logs": imported_logs,
            "trades": imported_trades
        },
        "skipped": {
            "decision_logs": skipped_logs,
            "trades": skipped_trades
        },
        "errors": errors[:10] if errors else []
    }


def _import_decision_log(
    db: Session,
    account_id: int,
    log_data: dict,
    target_prompt_template_id: Optional[int] = None,
    target_signal_trigger_id: Optional[int] = None
) -> AIDecisionLog:
    """Import a single decision log into the main database.

    Args:
        db: Database session
        account_id: Target account ID
        log_data: Decision log data from export
        target_prompt_template_id: Target trader's bound prompt template ID
        target_signal_trigger_id: Target trader's signal pool trigger ID
    """
    # Parse datetime fields
    decision_time = parse(log_data["decision_time"])
    pnl_updated_at = parse(log_data["pnl_updated_at"]) if log_data.get("pnl_updated_at") else None

    # Always use target trader's bindings (ignore source data values)
    new_log = AIDecisionLog(
        account_id=account_id,
        symbol=log_data.get("symbol"),
        decision_time=decision_time,
        operation=log_data["operation"],  # buy/sell/hold
        reason=log_data.get("reason"),
        prev_portion=log_data.get("prev_portion", 0),
        target_portion=log_data.get("target_portion", 0),
        total_balance=log_data.get("total_balance", 0),
        executed=log_data.get("executed", "false"),
        prompt_snapshot=log_data.get("prompt_snapshot"),
        reasoning_snapshot=log_data.get("reasoning_snapshot"),
        decision_snapshot=log_data.get("decision_snapshot"),
        hyperliquid_environment=log_data.get("hyperliquid_environment"),
        wallet_address=log_data.get("wallet_address"),
        hyperliquid_order_id=log_data.get("hyperliquid_order_id"),
        tp_order_id=log_data.get("tp_order_id"),
        sl_order_id=log_data.get("sl_order_id"),
        realized_pnl=log_data.get("realized_pnl"),
        pnl_updated_at=pnl_updated_at,
        # Use target trader's bindings for association
        signal_trigger_id=target_signal_trigger_id,
        prompt_template_id=target_prompt_template_id,
    )
    db.add(new_log)
    db.flush()
    return new_log


def _import_trade(snapshot_db: Session, account_id: int, trade_data: dict) -> HyperliquidTrade:
    """Import a single trade into the snapshot database."""
    new_trade = HyperliquidTrade(
        account_id=account_id,
        environment=trade_data.get("environment", "mainnet"),
        wallet_address=trade_data.get("wallet_address"),  # Keep original wallet address
        symbol=trade_data["symbol"],
        side=trade_data["side"],
        quantity=trade_data["quantity"],
        price=trade_data["price"],
        leverage=trade_data.get("leverage", 1),
        order_id=trade_data["order_id"],
        order_status="filled",
        trade_value=trade_data["trade_value"],
        fee=trade_data.get("fee", 0),
        trade_time=parse(trade_data["trade_time"])
    )
    snapshot_db.add(new_trade)
    snapshot_db.flush()
    return new_trade
