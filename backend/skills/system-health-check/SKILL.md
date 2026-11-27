---
name: system-health-check
shortcut: health
description: This skill should be used when the user asks to check system health, verify their setup is working correctly, or wants an overall status report. Trigger phrases include "check my system", "is everything working", "system status", "health check", "diagnose my setup", "what's the status".
description_zh: 当用户要求检查系统健康状况、验证配置是否正常或查看整体运行状态时使用此技能。
---

# System Health Check

Perform a comprehensive health assessment of the user's Hyper Alpha Arena
setup. Evaluate all components and provide an overall health score with
actionable recommendations.

## Workflow

### Phase 0: Foundation Check (Environment & Watchlist)

Before checking components, verify the system foundation:

1. **Trading Environment**: Use `get_trading_environment()`
   - Confirm current mode (testnet/mainnet)
   - Remind user this affects all operations

2. **Watchlist Configuration**: Use `get_watchlist()`
   - Check if user is still using default watchlist (only BTC)
   - If yes, flag as **Warning**: "Using default watchlist — only BTC data is being collected"
   - List symbols currently being monitored for each exchange
   - Check if any signal pools reference symbols NOT in the watchlist

→ [CHECKPOINT] Report environment and watchlist status. Flag warnings if using defaults.

### Phase 1: System Overview

Gather baseline data using `get_system_overview`:
- Total AI Traders count and their enabled/disabled status
- LLM configuration status (provider, model)
- Wallet binding status and balances
- Strategy binding overview (Prompt and Program counts)
- Signal pool status and active count

Present a quick summary table of component status.

→ [CHECKPOINT] Show system overview. Ask if user wants detailed checks.

### Phase 2: Runtime Status Check

Check active components:

- Use `list_traders` to inspect each trader:
  - Is trading enabled?
  - When was the last trigger (`last_trigger_at`)?
  - Are there any stuck traders (enabled but no recent triggers)?
- Check Program Bindings activation status
- Check signal pool recent trigger history
- Verify wallet balances are sufficient for trading

Flag any anomalies:
- Traders enabled but not triggering for >24 hours
- Signal pools with no recent signals
- Wallets with zero or very low balance
- Program bindings that are inactive

→ [CHECKPOINT] Present runtime status with health indicators.

### Phase 3: Error Log Analysis (Exchange-Aware)

Use `get_system_logs` to check for recent errors. The response now includes:
- **`severity_summary`**: counts of CRITICAL/WARNING/INFO/NOISE errors
- **`user_exchange`**: detected exchange (hyperliquid/binance/null)
- **`registry`** on each log: severity, exchange tag, affected subsystem, suggestion

**Filtering rules**:
1. **Ignore NOISE errors entirely** — they are transient/harmless
2. **Deprioritize `other_exchange` errors** — if a log's `registry.relevance` is `other_exchange`, it means the error is from an exchange the user doesn't use. Mention it only in passing (e.g., "also saw 3 Hyperliquid errors but you use Binance — not relevant to you")
3. **Focus on CRITICAL errors for user's active exchange** — these block trading
4. **Report WARNING errors** for user's exchange as secondary concerns
5. **Use registry suggestions** to provide actionable guidance

**Severity categories**:
- **CRITICAL**: Prevents trading (API down, insufficient balance, invalid keys)
- **WARNING**: Degraded functionality (stale data, parse errors, WS disconnects)
- **INFO**: Normal operations (price snapshots, HOLD decisions, notifications)
- **NOISE**: Scheduler overlaps, deprecation warnings, connection resets

→ [CHECKPOINT] Present overall health assessment:
  - Health score (Healthy / Needs Attention / Critical)
  - Summary of issues found, **filtered by user's exchange**
  - Prioritized list of recommended actions with registry suggestions
  - Offer to help fix any issues found

## Key Rules

- Always use tool calls for real data — never fabricate status
- Present results in a clear, non-technical format
- Prioritize actionable recommendations
- If everything is healthy, confirm it clearly
- For critical issues, offer to run trader-diagnosis skill
