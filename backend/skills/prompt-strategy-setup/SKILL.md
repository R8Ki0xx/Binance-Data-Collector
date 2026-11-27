---
name: prompt-strategy-setup
shortcut: prompt
description: This skill should be used when the user explicitly asks to CREATE or BUILD an AI-decision (Prompt-based) trading strategy. Trigger phrases include "create a prompt strategy", "build an AI trading strategy", "set up AI decision trading", "help me create a prompt-based strategy". Do NOT trigger for general questions about how strategies work or what prompt strategies are.
description_zh: 当用户要求创建或构建 AI 决策（Prompt）交易策略时使用此技能，引导完成完整的策略搭建流程。
---

# Prompt Strategy Setup (AI Decision)

Guide the user through creating a complete AI-decision trading pipeline
using Trading Prompts. This strategy type uses LLM interpretation for
trade decisions — best for complex judgment, sentiment, and context.

## Pre-requisites (MUST confirm before proceeding)

1. Confirm the target **exchange** (Hyperliquid or Binance)
2. Confirm the **environment** (Testnet or Mainnet)
3. These determine which wallets, signal pools, and data sources are available

## Workflow

### Phase 1: Requirements Gathering

Understand the user's trading intent:
- Which symbol(s) to trade (e.g., BTC, ETH, SOL)
- Trading style (trend following, mean reversion, breakout, etc.)
- Risk parameters (leverage, position size, stop loss preferences)
- Trigger preference (signal-based, scheduled, or both)

Use the user's profile (trading_style, risk_preference, experience_level)
to pre-fill defaults where possible. Skip questions the profile already answers.

→ [CHECKPOINT] Summarize understood requirements. Wait for user confirmation.

### Phase 2: Signal Pool Configuration

Query existing signal pools: `list_signal_pools`
- Filter by the confirmed exchange — signal pool exchange MUST match
- If a suitable pool exists, propose reusing it
- If no match, delegate to Signal AI: `call_signal_ai`
  - Include exchange, symbol, desired trigger frequency in the task
  - Save the result: `save_signal_pool`

A Prompt Trader can bind MULTIPLE signal pools. Suggest combinations
if the strategy benefits from multi-signal triggers.

→ [CHECKPOINT] Show signal pool(s) to be used. Wait for user confirmation.

### Phase 3: Trading Prompt Creation

Delegate to Prompt AI: `call_prompt_ai`
- Include: symbol, trading style, risk parameters, exchange context
- Prompt AI will use proper variables ({current_price}, {market_regime}, etc.)

Save the result: `save_prompt`

→ [CHECKPOINT] Show prompt summary. Wait for user confirmation.

### Phase 4: AI Trader Assembly

Query existing traders: `list_traders`
- If a suitable trader exists (correct exchange, has wallet), propose reusing
- If not, create one: `create_ai_trader` (LLM config only)

Bind the prompt: `bind_prompt_to_trader(trader_id, prompt_id)`
- This is ONE-TO-ONE: replaces any existing prompt binding

Configure triggers: `update_trader_strategy(trader_id, signal_pool_ids, ...)`
- signal_pool_ids: array of pool IDs (can be multiple)
- scheduled_trigger_enabled: true/false
- trigger_interval: seconds between scheduled triggers

→ [CHECKPOINT] Show complete configuration summary:
  - Trader name and LLM model
  - Bound prompt name
  - Signal pool(s) with conditions
  - Trigger settings
  Wait for user confirmation.

### Phase 5: Activation Guide

These are SECURITY OPERATIONS that require manual user action:

1. **Bind Wallet** → [AI Trader](/#trader-management) → click the trader → bind wallet section
   - Hyperliquid: create API Wallet on Hyperliquid website, paste agent private key + master wallet address
   - Binance: paste API key + secret key
   - Wallet exchange must match the confirmed exchange
2. **Start Trading** → [AI Trader](/#trader-management) → click the trader → "Start Trading" toggle

Offer to verify after user completes: `diagnose_trader_issues(trader_id)`

## Key Rules

- Signal pool exchange MUST match the trader's wallet exchange
- Never guess thresholds — always delegate to Signal AI
- Never write prompts yourself — always delegate to Prompt AI
- One Trader = One Prompt (one-to-one binding)
- One Trader = Multiple Signal Pools (one-to-many trigger config)
