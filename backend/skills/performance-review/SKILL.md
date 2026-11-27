---
name: performance-review
shortcut: review
description: This skill should be used when the user asks to review trading performance, analyze wins/losses, or understand why their strategy is underperforming. Trigger phrases include "analyze my trades", "how is my strategy doing", "why am I losing", "review performance", "trading results", "what went wrong".
description_zh: 当用户要求回顾交易表现、分析盈亏或了解策略表现不佳的原因时使用此技能。
---

# Performance Review

Analyze trading performance and provide actionable optimization suggestions.
Combines Attribution AI analysis with memory-based historical context.

## Pre-requisites (MUST confirm before proceeding)

1. Confirm which **trader** or **strategy** to analyze
2. Confirm the **time period** (last 7 days, 30 days, specific range)
3. Confirm the **exchange** and **environment**

## Workflow

### Phase 1: Performance Data Collection

- `list_traders(trader_id)` → get trader details and current status
- `get_wallet_status(wallet_address)` → current balance and positions

Delegate deep analysis to Attribution AI:
- `call_attribution_ai(task="Analyze trading performance for trader X over the last N days. Identify patterns in winning and losing trades.")`

→ [CHECKPOINT] Present performance summary in plain language:
  - Overall P&L
  - Win rate and profit factor
  - Best and worst trades
  - Common patterns in losses
  Wait for user to ask questions or request optimization.

### Phase 2: Insight Extraction

From the analysis, identify:
- Strategy strengths (what's working)
- Strategy weaknesses (what's not)
- Market conditions where strategy underperforms
- Risk management observations

These insights will be automatically saved to user memory
by the context compression system for future reference.

→ [CHECKPOINT] Present key insights and ask if user wants optimization suggestions.

### Phase 3: Optimization Suggestions (if requested)

Based on findings, suggest specific improvements:

**Signal Pool Adjustments:**
- Trigger frequency too high/low
- Missing market regime filters
- Thresholds need recalibration

**Strategy Logic Adjustments:**
- Risk parameters (leverage, position size, stop loss)
- Entry/exit conditions
- Market regime awareness

If user agrees to optimize:
- Delegate to appropriate sub-agent with specific improvement instructions
- Use existing resource IDs (edit, not create new)
- Follow resource-management patterns

→ [CHECKPOINT] Show proposed changes before applying. Wait for user confirmation.

## Key Rules

- Always delegate analysis to Attribution AI — don't guess performance data
- Present numbers in user-friendly format (percentages, not raw decimals)
- Be honest about poor performance — don't sugarcoat
- Always frame suggestions as options, not directives
- Remind users that past performance doesn't guarantee future results
