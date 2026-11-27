---
name: trader-diagnosis
shortcut: diagnose
description: This skill should be used when the user reports that their AI Trader is not triggering, not executing trades, or behaving unexpectedly. Trigger phrases include "why isn't my trader working", "strategy not executing", "no trades happening", "trader not triggering", "why no signals".
description_zh: 当用户反馈 AI Trader 没有触发、没有执行交易或行为异常时使用此技能进行系统化诊断。
---

# Trader Diagnosis

Systematically diagnose why an AI Trader is not triggering or executing
trades as expected. Follow a structured checklist approach.

## Pre-requisites (MUST confirm before proceeding)

1. Identify WHICH trader has the issue (if user doesn't specify, `list_traders` and ask)
2. Confirm the **exchange** and **environment** the trader is on

## Workflow

### Phase 0: Environment and Data Foundation Check

Before diagnosing the trader itself, verify the system foundation:

1. **Check trading environment**: `get_trading_environment()`
   - Confirm it matches what user expects (testnet vs mainnet)
   - If mismatch, guide user to switch via UI top-right mode switcher

2. **Check watchlist**: `get_watchlist()`
   - Verify the symbol(s) the trader's signal pools monitor are in the watchlist
   - If using default config (only BTC), warn user that other symbols have no data
   - If target symbol missing, use `update_watchlist()` to add it (after user confirmation)

→ [CHECKPOINT] Report environment and watchlist status. If issues found here, they are ROOT CAUSES — fix them first before proceeding.

### Phase 1: Full Diagnostic Scan

Run comprehensive diagnosis: `diagnose_trader_issues(trader_id)`

This checks:
- Trader enabled status
- Wallet binding and balance
- Strategy binding (prompt or program)
- Signal pool configuration and recent triggers
- Cooldown timer status
- Recent error logs

→ [CHECKPOINT] Present diagnostic results in plain language. Categorize issues found.

### Phase 2: Issue Resolution

Based on diagnostic results, address each issue:

**Configuration Issues (you can fix):**
- Signal pool not bound → help bind one (confirm exchange match)
- Trigger interval too long → suggest adjustment
- Signal thresholds too strict → delegate to Signal AI for recalibration

**Manual Operations (guide user to UI):**
- Wallet not bound → [AI Trader](/#trader-management) → click trader → bind wallet (Hyperliquid: API Wallet key + master address; Binance: API key + secret)
- Trading not started → [AI Trader](/#trader-management) → click trader → "Start Trading"
- Program binding not active → [Programs](/#program-trader) → "Program Bindings" → Edit → activation switch

**Data Issues (investigate further):**
- API errors → check `get_system_logs` for details
- Balance insufficient → advise deposit to the master wallet address (for Hyperliquid API Wallet)
- Exchange connectivity → verify API key / API Wallet status

→ [CHECKPOINT] Summarize fixes applied and remaining manual steps. Wait for user to complete manual actions.

### Phase 3: Verification

After user completes manual steps:
- Re-run `diagnose_trader_issues(trader_id)` to verify all clear
- Check `list_traders(trader_id)` for current status
- Confirm the trader is now ready to execute

## Key Rules

- Always run the full diagnostic first, don't guess
- Signal pool exchange must match trader's wallet exchange
- Be specific about UI paths for manual operations
- If the issue is "signal triggered but AI decided HOLD", explain this is normal behavior
