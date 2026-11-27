---
name: program-strategy-setup
shortcut: program
description: This skill should be used when the user explicitly asks to CREATE or BUILD a programmatic (Python code) trading strategy. Trigger phrases include "create a program strategy", "build a trading program", "set up programmatic trading", "write a trading bot", "create a Python strategy". Do NOT trigger for general questions about how programs work.
description_zh: 当用户要求创建或构建程序化（Python）交易策略时使用此技能，引导完成完整的程序策略搭建流程。
---

# Program Strategy Setup (Programmatic Decision)

Guide the user through creating a complete programmatic trading pipeline
using Trading Programs. This strategy type executes Python code directly —
best for structured rules, precise thresholds, and deterministic behavior.

## Pre-requisites (MUST confirm before proceeding)

1. Confirm the target **exchange** (Hyperliquid or Binance)
2. Confirm the **environment** (Testnet or Mainnet)
3. These determine which wallets, signal pools, and data sources are available

## Workflow

### Phase 1: Requirements Gathering

Understand the user's trading intent:
- Which symbol(s) to trade
- Strategy type (grid trading, DCA, momentum, arbitrage, etc.)
- Specific parameters (price ranges, grid spacing, position sizes)
- Trigger preference (signal-based, scheduled, or both)

Use the user's profile to pre-fill defaults where possible.

→ [CHECKPOINT] Summarize understood requirements. Wait for user confirmation.

### Phase 2: Signal Pool Configuration

Query existing signal pools: `list_signal_pools`
- Filter by the confirmed exchange — signal pool exchange MUST match
- If a suitable pool exists, propose reusing it
- If no match, delegate to Signal AI: `call_signal_ai`
  - Include exchange, symbol, desired trigger frequency in the task
  - Save the result: `save_signal_pool`

→ [CHECKPOINT] Show signal pool(s) to be used. Wait for user confirmation.

### Phase 3: Trading Program Creation

Delegate to Program AI: `call_program_ai`
- Include: symbol, strategy logic, parameters, exchange context
- Program AI will use the proper API (HyperliquidTradingClient or BinanceTradingClient)

Save the result: `save_program`

→ [CHECKPOINT] Show program summary (name, description, key logic). Wait for user confirmation.

### Phase 4: Binding Assembly

This is where Program strategy differs from Prompt strategy:
- Program uses **Binding** (many-to-many), not direct trader assignment
- Signal pools and trigger config are set ON THE BINDING, not on the trader

Query existing traders: `list_traders`
- Need a trader with a wallet on the confirmed exchange
- If none exists, create one: `create_ai_trader`

Create the binding: `bind_program_to_trader(trader_id, program_id, signal_pool_ids, trigger_interval)`
- This creates an AccountProgramBinding
- signal_pool_ids and trigger_interval are part of the binding itself
- One trader can have MULTIPLE program bindings

→ [CHECKPOINT] Show complete configuration summary:
  - Trader name and wallet
  - Program name and description
  - Binding: signal pool(s) + trigger interval
  Wait for user confirmation.

### Phase 5: Activation Guide

These are SECURITY OPERATIONS that require manual user action:

1. **Bind Wallet** (if not already bound) → [AI Trader](/#trader-management) → click trader → bind wallet
   - Hyperliquid: create API Wallet on Hyperliquid website, paste agent private key + master wallet address
   - Binance: paste API key + secret key
   - Wallet exchange must match the confirmed exchange
2. **Activate Program Binding** → [Programs](/#program-trader) → "Program Bindings" → click the binding → Edit → activation switch
   - Note: Program bindings do NOT use the trader's "Start Trading" toggle
   - The binding itself controls activation

Offer to verify after user completes: `diagnose_trader_issues(trader_id)`

## Key Rules

- Signal pool exchange MUST match the trader's wallet exchange
- Never write Python code yourself — always delegate to Program AI
- Program Binding = program + signal pools + trigger interval (all in one)
- One Trader can have MULTIPLE Program Bindings (different programs, different triggers)
- Activation is on the BINDING, not on the trader's "Start Trading" toggle
