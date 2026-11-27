---
name: market-analysis
shortcut: market
description: This skill should be used when the user explicitly asks for market analysis, current market conditions, or strategy recommendations based on market state. Trigger phrases include "analyze the market", "what's BTC doing", "current market conditions", "is it a good time to trade", "market overview for ETH".
description_zh: 当用户请求市场分析、当前行情或基于市场状态的策略建议时使用此技能。
---

# Market Analysis

Provide comprehensive market analysis by combining multiple data sources.
Help users understand current conditions and suggest strategy directions.

## Pre-requisites (MUST confirm before proceeding)

1. Confirm which **symbol(s)** to analyze (or use profile's preferred_symbols)
2. Confirm the **exchange** (Hyperliquid or Binance — data sources differ)

## Workflow

### Phase 1: Multi-Dimensional Data Collection

Gather data in parallel where possible:
- `get_klines(symbol, interval, limit)` → recent price action
- `get_market_regime(symbol)` → regime classification (breakout/trending/ranging/etc.)
- `get_market_flow(symbol)` → CVD, OI changes, funding rate

### Phase 2: Synthesis and Presentation

Combine data into a coherent analysis:
- Current market regime and what it means
- Price trend direction and strength
- Volume and open interest dynamics
- Funding rate sentiment (extreme = potential reversal signal)
- Key support/resistance levels from recent price action

Present in plain language appropriate to user's experience level.

→ [CHECKPOINT] Present analysis. Ask if user wants strategy suggestions or deeper analysis on any aspect.

### Phase 3: Strategy Suggestions (if requested)

Based on analysis and user profile:
- Conservative users → emphasize risk management, smaller positions
- Aggressive users → highlight opportunities, but still note risks
- Match suggestions to current market regime:
  - Trending → trend following strategies
  - Ranging → mean reversion or grid strategies
  - Breakout → momentum strategies with tight stops

If user wants to act on a suggestion:
- Guide them to the appropriate strategy setup skill
- "Would you like me to help create this strategy?" → triggers prompt-strategy-setup or program-strategy-setup

## Key Rules

- All data MUST come from tool calls — never fabricate market data
- Never provide specific price predictions or financial advice
- Always remind users that trading involves risk
- Tailor language to user's experience_level from profile
