---
name: resource-management
shortcut: resource
description: This skill should be used when the user wants to MODIFY, REBIND, DELETE, or REORGANIZE existing trading resources (strategies, signal pools, traders, bindings). Trigger phrases include "change my strategy", "rebind signal pool", "modify my prompt", "update my program", "switch to a different signal pool", "delete this trader".
description_zh: 当用户要求修改、重新绑定、删除或重组现有交易资源（策略、信号池、Trader、绑定）时使用此技能。
---

# Resource Management

Help users manage and reorganize their existing trading resources.
Core principle: never create duplicates — always check what exists first.

## Pre-requisites (MUST confirm before proceeding)

1. Confirm which resource(s) the user wants to modify
2. Confirm the **exchange** context (affects which resources are compatible)

## Workflow

### Phase 1: Resource Survey

Query all relevant resources:
- `list_traders` → traders, their bindings, wallets, status
- `list_signal_pools` → pools with symbols and conditions
- `list_strategies` → prompts and programs with binding status

Present a clear summary of what exists, using natural language:
- Resource names (not IDs)
- Current bindings and relationships
- Active/inactive status

→ [CHECKPOINT] Show resource inventory. Confirm what the user wants to change.

### Phase 2: Execute Changes

Based on user intent:

**Modify strategy content:**
- Get full content: `list_strategies(strategy_id=X, strategy_type="prompt"|"program")`
- Delegate edit to sub-agent with existing ID:
  - `call_prompt_ai(task="...", prompt_id=X)` for prompts
  - `call_program_ai(task="...", program_id=X)` for programs
- Save with existing ID to update (not create new)

**Rebind resources:**
- `bind_prompt_to_trader` — replaces existing prompt binding (one-to-one)
- `bind_program_to_trader` — creates new binding (many-to-many)
- `update_trader_strategy` — change signal pools or trigger config
- Always verify exchange compatibility before binding

**Adjust signal pools:**
- Describe current config and desired changes to Signal AI
- `call_signal_ai(task="adjust thresholds for pool X...")`
- Save with existing pool ID to update

→ [CHECKPOINT] Show what was changed. Wait for user confirmation.

### Phase 3: Verify

- Re-query affected resources to confirm changes applied
- If bindings changed, offer to run `diagnose_trader_issues` to verify health

## Key Rules

- ALWAYS survey existing resources before any operation
- Signal pool exchange must match trader's wallet exchange when rebinding
- Use existing IDs when updating — do not create duplicates
- For read-only queries (view/explain), use query tools directly, not sub-agents
