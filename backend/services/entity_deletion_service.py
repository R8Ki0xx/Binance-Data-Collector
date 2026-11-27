"""
Entity Deletion Service - Soft delete with dependency checking.

General-purpose deletion functions usable by both AI tools and UI API endpoints.
All deletions follow the pattern:
1. Check dependencies (active references from other entities)
2. If dependencies exist, return dependency report (do NOT delete)
3. If no dependencies, perform soft delete (set is_deleted=True, deleted_at=now)

Each function returns a dict with:
- success: bool
- deleted: bool (True if actually deleted, False if blocked by dependencies)
- dependencies: list of dependency descriptions (when blocked)
- entity: dict with deleted entity info (when successful)
"""

import json
import logging
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


def check_trader_dependencies(db: Session, trader_id: int) -> List[str]:
    """Check all dependencies that block AI Trader deletion.

    Checks:
    - Active or inactive prompt bindings
    - Active or inactive program bindings
    - Open positions (Hyperliquid/Binance)
    """
    from database.models import (
        AccountPromptBinding, AccountProgramBinding,
        HyperliquidPosition
    )
    deps = []

    # Check prompt binding
    binding = db.query(AccountPromptBinding).filter(
        AccountPromptBinding.account_id == trader_id,
        AccountPromptBinding.is_deleted != True
    ).first()
    if binding:
        deps.append(
            f"Prompt binding exists (binding #{binding.id}, "
            f"template #{binding.prompt_template_id})"
        )

    # Check program bindings (any, active or not)
    prog_bindings = db.query(AccountProgramBinding).filter(
        AccountProgramBinding.account_id == trader_id,
        AccountProgramBinding.is_deleted != True
    ).all()
    for pb in prog_bindings:
        status = "active" if pb.is_active else "inactive"
        deps.append(
            f"Program binding #{pb.id} ({status}, "
            f"program #{pb.program_id})"
        )

    # Check open positions
    positions = db.query(HyperliquidPosition).filter(
        HyperliquidPosition.account_id == trader_id
    ).all()
    for pos in positions:
        if pos.size and float(pos.size) != 0:
            deps.append(
                f"Open position: {pos.symbol} "
                f"size={pos.size} on {pos.environment or 'unknown'}"
            )

    return deps


def delete_trader(db: Session, trader_id: int) -> Dict[str, Any]:
    """Soft-delete an AI Trader after dependency check.

    Also soft-deletes associated wallet configurations.
    """
    from database.models import Account, HyperliquidWallet, BinanceWallet

    account = db.query(Account).filter(
        Account.id == trader_id,
        Account.is_deleted != True
    ).first()
    if not account:
        return {"success": False, "error": "Trader not found or already deleted"}

    deps = check_trader_dependencies(db, trader_id)
    if deps:
        return {
            "success": True, "deleted": False,
            "dependencies": deps,
            "message": "Cannot delete: has active dependencies. Remove them first."
        }

    now = datetime.now(timezone.utc)
    account.is_deleted = True
    account.deleted_at = now
    account.is_active = "false"

    # Soft-delete associated wallets
    wallets_deleted = 0
    for WalletModel in [HyperliquidWallet, BinanceWallet]:
        wallets = db.query(WalletModel).filter(
            WalletModel.account_id == trader_id
        ).all()
        for w in wallets:
            w.is_active = "false"
            wallets_deleted += 1

    db.commit()
    return {
        "success": True, "deleted": True,
        "entity": {
            "id": account.id, "name": account.name,
            "wallets_deactivated": wallets_deleted
        }
    }


def check_prompt_template_dependencies(db: Session, prompt_id: int) -> List[str]:
    """Check dependencies that block Prompt Template deletion.

    Checks:
    - Any non-deleted prompt bindings referencing this template
    """
    from database.models import AccountPromptBinding, Account
    deps = []

    bindings = db.query(AccountPromptBinding).filter(
        AccountPromptBinding.prompt_template_id == prompt_id,
        AccountPromptBinding.is_deleted != True
    ).all()
    for b in bindings:
        acc = db.query(Account).filter(Account.id == b.account_id).first()
        name = acc.name if acc else f"#{b.account_id}"
        deps.append(f"Bound to AI Trader: {name} (binding #{b.id})")

    return deps


def delete_prompt_template(db: Session, prompt_id: int) -> Dict[str, Any]:
    """Soft-delete a Prompt Template after dependency check."""
    from database.models import PromptTemplate

    tpl = db.query(PromptTemplate).filter(
        PromptTemplate.id == prompt_id,
        PromptTemplate.is_deleted == "false"
    ).first()
    if not tpl:
        return {"success": False, "error": "Prompt template not found or already deleted"}

    if tpl.is_system == "true":
        return {"success": False, "error": "Cannot delete system templates"}

    deps = check_prompt_template_dependencies(db, prompt_id)
    if deps:
        return {
            "success": True, "deleted": False,
            "dependencies": deps,
            "message": "Cannot delete: template is bound to traders. Unbind first."
        }

    tpl.is_deleted = "true"
    tpl.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {
        "success": True, "deleted": True,
        "entity": {"id": tpl.id, "name": tpl.name}
    }


def check_signal_definition_dependencies(db: Session, signal_id: int) -> List[str]:
    """Check dependencies that block Signal Definition deletion.

    Checks:
    - Any non-deleted signal pools referencing this signal in signal_ids JSON
    """
    from database.models import SignalPool
    deps = []

    pools = db.query(SignalPool).filter(
        SignalPool.is_deleted != True
    ).all()
    for pool in pools:
        try:
            ids = json.loads(pool.signal_ids) if pool.signal_ids else []
        except (json.JSONDecodeError, TypeError):
            ids = []
        if signal_id in ids:
            deps.append(f"Referenced by Signal Pool: {pool.pool_name} (#{pool.id})")

    return deps


def delete_signal_definition(db: Session, signal_id: int) -> Dict[str, Any]:
    """Soft-delete a Signal Definition after dependency check."""
    from database.models import SignalDefinition

    sig = db.query(SignalDefinition).filter(
        SignalDefinition.id == signal_id,
        SignalDefinition.is_deleted != True
    ).first()
    if not sig:
        return {"success": False, "error": "Signal definition not found or already deleted"}

    deps = check_signal_definition_dependencies(db, signal_id)
    if deps:
        return {
            "success": True, "deleted": False,
            "dependencies": deps,
            "message": "Cannot delete: signal is used in pools. Remove from pools first."
        }

    sig.is_deleted = True
    sig.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {
        "success": True, "deleted": True,
        "entity": {"id": sig.id, "name": sig.signal_name}
    }


def check_signal_pool_dependencies(db: Session, pool_id: int) -> List[str]:
    """Check dependencies that block Signal Pool deletion.

    Checks:
    - AccountStrategyConfig.signal_pool_ids (AI Strategy / Prompt line)
    - AccountProgramBinding.signal_pool_ids (Program line)
    - TraderTriggerConfig.signal_pool_ids (legacy trigger config)
    """
    from database.models import (
        AccountStrategyConfig, AccountProgramBinding,
        TraderTriggerConfig, Account
    )
    deps = []

    # Check AI Strategy configs
    configs = db.query(AccountStrategyConfig).all()
    for cfg in configs:
        try:
            ids = json.loads(cfg.signal_pool_ids) if cfg.signal_pool_ids else []
        except (json.JSONDecodeError, TypeError):
            ids = []
        if pool_id in ids:
            acc = db.query(Account).filter(Account.id == cfg.account_id).first()
            name = acc.name if acc else f"#{cfg.account_id}"
            deps.append(f"Used by AI Strategy of Trader: {name}")

    # Check Program Bindings
    bindings = db.query(AccountProgramBinding).filter(
        AccountProgramBinding.is_deleted != True
    ).all()
    for b in bindings:
        try:
            ids = json.loads(b.signal_pool_ids) if b.signal_pool_ids else []
        except (json.JSONDecodeError, TypeError):
            ids = []
        if pool_id in ids:
            deps.append(f"Used by Program Binding #{b.id} (program #{b.program_id})")

    # Check TraderTriggerConfig (legacy)
    triggers = db.query(TraderTriggerConfig).all()
    for t in triggers:
        try:
            ids = json.loads(t.signal_pool_ids) if t.signal_pool_ids else []
        except (json.JSONDecodeError, TypeError):
            ids = []
        if pool_id in ids:
            deps.append(f"Used by TraderTriggerConfig: {t.trader_id}")

    return deps


def delete_signal_pool(db: Session, pool_id: int) -> Dict[str, Any]:
    """Soft-delete a Signal Pool after dependency check."""
    from database.models import SignalPool

    pool = db.query(SignalPool).filter(
        SignalPool.id == pool_id,
        SignalPool.is_deleted != True
    ).first()
    if not pool:
        return {"success": False, "error": "Signal pool not found or already deleted"}

    deps = check_signal_pool_dependencies(db, pool_id)
    if deps:
        return {
            "success": True, "deleted": False,
            "dependencies": deps,
            "message": "Cannot delete: pool is referenced by strategies. Remove references first."
        }

    pool.is_deleted = True
    pool.deleted_at = datetime.now(timezone.utc)
    pool.enabled = False
    db.commit()
    return {
        "success": True, "deleted": True,
        "entity": {"id": pool.id, "name": pool.pool_name}
    }


def check_trading_program_dependencies(db: Session, program_id: int) -> List[str]:
    """Check dependencies that block Trading Program deletion.

    Checks:
    - Any non-deleted program bindings referencing this program
    """
    from database.models import AccountProgramBinding, Account
    deps = []

    bindings = db.query(AccountProgramBinding).filter(
        AccountProgramBinding.program_id == program_id,
        AccountProgramBinding.is_deleted != True
    ).all()
    for b in bindings:
        acc = db.query(Account).filter(Account.id == b.account_id).first()
        name = acc.name if acc else f"#{b.account_id}"
        status = "active" if b.is_active else "inactive"
        deps.append(f"Bound to Trader: {name} (binding #{b.id}, {status})")

    return deps


def delete_trading_program(db: Session, program_id: int) -> Dict[str, Any]:
    """Soft-delete a Trading Program after dependency check."""
    from database.models import TradingProgram

    prog = db.query(TradingProgram).filter(
        TradingProgram.id == program_id,
        TradingProgram.is_deleted != True
    ).first()
    if not prog:
        return {"success": False, "error": "Trading program not found or already deleted"}

    deps = check_trading_program_dependencies(db, program_id)
    if deps:
        return {
            "success": True, "deleted": False,
            "dependencies": deps,
            "message": "Cannot delete: program has bindings. Remove bindings first."
        }

    prog.is_deleted = True
    prog.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {
        "success": True, "deleted": True,
        "entity": {"id": prog.id, "name": prog.name}
    }


def delete_prompt_binding(db: Session, binding_id: int) -> Dict[str, Any]:
    """Soft-delete a Prompt Binding (unbind prompt from trader)."""
    from database.models import AccountPromptBinding

    binding = db.query(AccountPromptBinding).filter(
        AccountPromptBinding.id == binding_id,
        AccountPromptBinding.is_deleted != True
    ).first()
    if not binding:
        return {"success": False, "error": "Prompt binding not found or already deleted"}

    binding.is_deleted = True
    binding.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {
        "success": True, "deleted": True,
        "entity": {
            "id": binding.id,
            "account_id": binding.account_id,
            "prompt_template_id": binding.prompt_template_id
        }
    }


def delete_program_binding(db: Session, binding_id: int) -> Dict[str, Any]:
    """Soft-delete a Program Binding after checking active status.

    Blocks deletion if binding is_active=True (running strategy).
    """
    from database.models import AccountProgramBinding

    binding = db.query(AccountProgramBinding).filter(
        AccountProgramBinding.id == binding_id,
        AccountProgramBinding.is_deleted != True
    ).first()
    if not binding:
        return {"success": False, "error": "Program binding not found or already deleted"}

    if binding.is_active:
        return {
            "success": True, "deleted": False,
            "dependencies": ["Binding is currently active (is_active=True)"],
            "message": "Cannot delete: binding is active. Deactivate it first."
        }

    binding.is_deleted = True
    binding.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {
        "success": True, "deleted": True,
        "entity": {
            "id": binding.id,
            "account_id": binding.account_id,
            "program_id": binding.program_id
        }
    }
