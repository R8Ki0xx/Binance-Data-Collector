"""
Prompt Backtest API Routes

Provides endpoints for:
- Creating backtest tasks
- Querying task status and progress
- Querying comparison results
- Getting individual item details
"""

import json
import logging
from datetime import datetime, timezone
from typing import List, Optional
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database.connection import get_db
from database.models import (
    Account,
    AIDecisionLog,
    PromptTemplate,
    PromptBacktestTask,
    PromptBacktestItem,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/prompt-backtest", tags=["prompt-backtest"])


# ============================================================================
# Pydantic Models
# ============================================================================

class ReplaceRule(BaseModel):
    find: str
    replace: str


class BacktestItemInput(BaseModel):
    decision_log_id: int
    modified_prompt: str


class CreateTaskRequest(BaseModel):
    account_id: int
    name: Optional[str] = None
    items: List[BacktestItemInput]
    replace_rules: Optional[List[ReplaceRule]] = None


class TaskStatusResponse(BaseModel):
    id: int
    account_id: int
    name: Optional[str]
    status: str
    total_count: int
    completed_count: int
    failed_count: int
    created_at: str
    started_at: Optional[str]
    finished_at: Optional[str]


class ResultItemResponse(BaseModel):
    id: int
    original_decision_time: Optional[str]
    original_operation: Optional[str]
    original_symbol: Optional[str]
    original_target_portion: Optional[float]
    original_realized_pnl: Optional[float]
    new_operation: Optional[str]
    new_symbol: Optional[str]
    new_target_portion: Optional[float]
    decision_changed: Optional[bool]
    change_type: Optional[str]
    status: str


class ResultSummary(BaseModel):
    total: int
    completed: int
    failed: int
    changed: int
    unchanged: int
    avoided_loss_count: int
    avoided_loss_amount: float
    missed_profit_count: int
    missed_profit_amount: float


class ResultsResponse(BaseModel):
    task: TaskStatusResponse
    items: List[ResultItemResponse]
    summary: ResultSummary


class ItemDetailResponse(BaseModel):
    id: int
    original_operation: Optional[str]
    original_symbol: Optional[str]
    original_reasoning: Optional[str]
    original_decision_json: Optional[str]
    original_prompt_template_name: Optional[str]
    modified_prompt: Optional[str]
    new_operation: Optional[str]
    new_symbol: Optional[str]
    new_reasoning: Optional[str]
    new_decision_json: Optional[str]
    decision_changed: Optional[bool]
    change_type: Optional[str]
    error_message: Optional[str]


# ============================================================================
# Helper Functions
# ============================================================================

def _format_timestamp(ts) -> Optional[str]:
    """Format timestamp to ISO string."""
    if ts is None:
        return None
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return ts.isoformat()


def _decimal_to_float(val) -> Optional[float]:
    """Convert Decimal to float safely."""
    if val is None:
        return None
    return float(val)


def _build_task_response(task: PromptBacktestTask) -> TaskStatusResponse:
    """Build task status response from ORM object."""
    return TaskStatusResponse(
        id=task.id,
        account_id=task.account_id,
        name=task.name,
        status=task.status,
        total_count=task.total_count,
        completed_count=task.completed_count,
        failed_count=task.failed_count,
        created_at=_format_timestamp(task.created_at),
        started_at=_format_timestamp(task.started_at),
        finished_at=_format_timestamp(task.finished_at),
    )


# ============================================================================
# API Endpoints
# ============================================================================

@router.post("/tasks")
def create_backtest_task(
    request: CreateTaskRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Create a new prompt backtest task."""
    # Validate account exists
    account = db.query(Account).filter(Account.id == request.account_id, Account.is_deleted != True).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    # Get wallet/environment from first decision log
    first_log = None
    if request.items:
        first_log = db.query(AIDecisionLog).filter(
            AIDecisionLog.id == request.items[0].decision_log_id
        ).first()

    # Create task
    task = PromptBacktestTask(
        account_id=request.account_id,
        wallet_address=first_log.wallet_address if first_log else None,
        environment=first_log.hyperliquid_environment if first_log else None,
        name=request.name,
        status="pending",
        total_count=len(request.items),
        completed_count=0,
        failed_count=0,
        replace_rules=json.dumps([r.dict() for r in request.replace_rules]) if request.replace_rules else None,
    )
    db.add(task)
    db.flush()  # Get task.id

    # Create items with original data snapshot
    for item_input in request.items:
        original_log = db.query(AIDecisionLog).filter(
            AIDecisionLog.id == item_input.decision_log_id
        ).first()

        if not original_log:
            logger.warning(f"Decision log {item_input.decision_log_id} not found, skipping")
            continue

        # Get prompt template name
        template_name = None
        if original_log.prompt_template_id:
            template = db.query(PromptTemplate).filter(
                PromptTemplate.id == original_log.prompt_template_id,
                PromptTemplate.is_deleted == "false"
            ).first()
            if template:
                template_name = template.name

        item = PromptBacktestItem(
            task_id=task.id,
            original_decision_log_id=original_log.id,
            status="pending",
            original_operation=original_log.operation,
            original_symbol=original_log.symbol,
            original_target_portion=original_log.target_portion,
            original_reasoning=original_log.reasoning_snapshot,
            original_decision_json=original_log.decision_snapshot,
            original_realized_pnl=original_log.realized_pnl,
            original_decision_time=original_log.decision_time,
            original_prompt_template_name=template_name,
            modified_prompt=item_input.modified_prompt,
        )
        db.add(item)

    db.commit()

    # Start background execution
    from services.prompt_backtest_service import execute_backtest_task
    background_tasks.add_task(execute_backtest_task, task.id)

    return {
        "task_id": task.id,
        "status": task.status,
        "total_count": task.total_count,
    }


@router.get("/tasks")
def list_backtest_tasks(
    account_id: Optional[int] = None,
    limit: int = 20,
    db: Session = Depends(get_db),
):
    """List backtest tasks, optionally filtered by account."""
    query = db.query(PromptBacktestTask).order_by(PromptBacktestTask.created_at.desc())

    if account_id:
        query = query.filter(PromptBacktestTask.account_id == account_id)

    tasks = query.limit(limit).all()

    return {
        "tasks": [_build_task_response(t).dict() for t in tasks]
    }


@router.get("/tasks/{task_id}")
def get_task_status(
    task_id: int,
    db: Session = Depends(get_db),
):
    """Get task status and progress."""
    task = db.query(PromptBacktestTask).filter(PromptBacktestTask.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    return _build_task_response(task).dict()


@router.get("/tasks/{task_id}/results")
def get_task_results(
    task_id: int,
    db: Session = Depends(get_db),
):
    """Get comparison results for a task."""
    task = db.query(PromptBacktestTask).filter(PromptBacktestTask.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    items = db.query(PromptBacktestItem).filter(
        PromptBacktestItem.task_id == task_id
    ).order_by(PromptBacktestItem.original_decision_time.desc()).all()

    # Build response items
    result_items = []
    for item in items:
        result_items.append(ResultItemResponse(
            id=item.id,
            original_decision_time=_format_timestamp(item.original_decision_time),
            original_operation=item.original_operation,
            original_symbol=item.original_symbol,
            original_target_portion=_decimal_to_float(item.original_target_portion),
            original_realized_pnl=_decimal_to_float(item.original_realized_pnl),
            new_operation=item.new_operation,
            new_symbol=item.new_symbol,
            new_target_portion=_decimal_to_float(item.new_target_portion),
            decision_changed=item.decision_changed,
            change_type=item.change_type,
            status=item.status,
        ))

    # Calculate summary
    completed = [i for i in items if i.status == "completed"]
    failed = [i for i in items if i.status == "failed"]
    changed = [i for i in completed if i.decision_changed]
    unchanged = [i for i in completed if not i.decision_changed]

    # Calculate avoided loss / missed profit
    avoided_loss_count = 0
    avoided_loss_amount = 0.0
    missed_profit_count = 0
    missed_profit_amount = 0.0

    for item in changed:
        pnl = _decimal_to_float(item.original_realized_pnl) or 0
        orig_op = (item.original_operation or "").lower()
        new_op = (item.new_operation or "").lower()

        # Original was entry (buy/sell) with loss, new is hold -> avoided loss
        if orig_op in ("buy", "sell") and new_op == "hold" and pnl < 0:
            avoided_loss_count += 1
            avoided_loss_amount += pnl

        # Original was entry with profit, new is hold -> missed profit
        if orig_op in ("buy", "sell") and new_op == "hold" and pnl > 0:
            missed_profit_count += 1
            missed_profit_amount += pnl

    summary = ResultSummary(
        total=len(items),
        completed=len(completed),
        failed=len(failed),
        changed=len(changed),
        unchanged=len(unchanged),
        avoided_loss_count=avoided_loss_count,
        avoided_loss_amount=avoided_loss_amount,
        missed_profit_count=missed_profit_count,
        missed_profit_amount=missed_profit_amount,
    )

    return {
        "task": _build_task_response(task).dict(),
        "items": [i.dict() for i in result_items],
        "summary": summary.dict(),
    }


@router.get("/items/{item_id}")
def get_item_detail(
    item_id: int,
    db: Session = Depends(get_db),
):
    """Get detailed information for a single backtest item."""
    item = db.query(PromptBacktestItem).filter(PromptBacktestItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    return ItemDetailResponse(
        id=item.id,
        original_operation=item.original_operation,
        original_symbol=item.original_symbol,
        original_reasoning=item.original_reasoning,
        original_decision_json=item.original_decision_json,
        original_prompt_template_name=item.original_prompt_template_name,
        modified_prompt=item.modified_prompt,
        new_operation=item.new_operation,
        new_symbol=item.new_symbol,
        new_reasoning=item.new_reasoning,
        new_decision_json=item.new_decision_json,
        decision_changed=item.decision_changed,
        change_type=item.change_type,
        error_message=item.error_message,
    ).dict()


@router.get("/tasks/{task_id}/items")
def get_task_items_for_import(
    task_id: int,
    db: Session = Depends(get_db),
):
    """Get all items from a task for importing into workspace.

    Returns the modified_prompt and original decision info for each item.
    """
    task = db.query(PromptBacktestTask).filter(PromptBacktestTask.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    items = db.query(PromptBacktestItem).filter(
        PromptBacktestItem.task_id == task_id
    ).all()

    # Get original decision logs for additional info
    decision_log_ids = [item.original_decision_log_id for item in items]
    decision_logs = db.query(AIDecisionLog).filter(
        AIDecisionLog.id.in_(decision_log_ids)
    ).all()
    decision_log_map = {dl.id: dl for dl in decision_logs}

    result_items = []
    for item in items:
        dl = decision_log_map.get(item.original_decision_log_id)
        result_items.append({
            "id": item.original_decision_log_id,
            "modified_prompt": item.modified_prompt,
            "operation": item.original_operation,
            "symbol": item.original_symbol,
            "reason": dl.reason if dl else None,
            "decision_time": _format_timestamp(dl.decision_time) if dl else None,
            "realized_pnl": _decimal_to_float(dl.realized_pnl) if dl else None,
        })

    return {
        "task_id": task_id,
        "task_name": task.name,
        "items": result_items,
    }


@router.delete("/tasks/{task_id}")
def delete_task(
    task_id: int,
    db: Session = Depends(get_db),
):
    """Delete a backtest task and all its items."""
    task = db.query(PromptBacktestTask).filter(PromptBacktestTask.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if task.status == "running":
        raise HTTPException(status_code=400, detail="Cannot delete running task")

    db.delete(task)
    db.commit()

    return {"success": True, "message": "Task deleted"}


@router.post("/tasks/{task_id}/retry")
def retry_failed_items(
    task_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Retry all failed items in a task."""
    task = db.query(PromptBacktestTask).filter(PromptBacktestTask.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if task.status == "running":
        raise HTTPException(status_code=400, detail="Task is already running")

    # Count failed items
    failed_items = db.query(PromptBacktestItem).filter(
        PromptBacktestItem.task_id == task_id,
        PromptBacktestItem.status == "failed"
    ).all()

    if not failed_items:
        return {
            "success": False,
            "message": "No failed items to retry",
            "retry_count": 0,
        }

    # Reset failed items to pending
    for item in failed_items:
        item.status = "pending"
        item.error_message = None
        item.new_operation = None
        item.new_symbol = None
        item.new_target_portion = None
        item.new_reasoning = None
        item.new_decision_json = None
        item.decision_changed = None
        item.change_type = None

    # Update task status and counts
    task.status = "pending"
    task.failed_count = 0
    task.finished_at = None

    db.commit()

    # Start background execution
    from services.prompt_backtest_service import execute_backtest_task
    background_tasks.add_task(execute_backtest_task, task.id)

    return {
        "success": True,
        "message": f"Retrying {len(failed_items)} failed items",
        "retry_count": len(failed_items),
    }
