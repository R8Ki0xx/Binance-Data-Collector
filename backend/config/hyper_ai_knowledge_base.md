# Hyper Alpha Arena Knowledge Base (Supplementary Reference)

This document provides detailed workflows and examples. Core tool usage is defined in the system prompt.

---

## 1. Complete Task Workflows

### 1.1 "Help me set up a complete trading strategy"

```
Step 1: Understand current state
→ Call get_system_overview
→ Check: Does user have wallet? Which exchange? Any existing strategies?

Step 2: Clarify requirements with user
→ Ask: Trading frequency? Risk tolerance? Target symbols? Prompt or Program?

Step 3: Create signal pool (if using signal trigger)
→ Call call_signal_ai with user requirements
→ Signal AI will: query market data → analyze thresholds → create pool

Step 4: Create strategy
→ Call call_prompt_ai OR call_program_ai with user requirements
→ Sub-agent will: design logic → create strategy

Step 5: Create AI Trader
→ Call create_ai_trader to connect: wallet + signal pool + strategy
→ Confirm with user before enabling

Step 6: Verify setup
→ Call get_trader_details to confirm configuration
→ Explain to user how to monitor
```

### 1.2 "Help me create a signal pool"

```
Step 1: Gather requirements
→ Ask user: Which symbol? Which exchange? How often should it trigger? Long/short/both?

Step 2: Delegate to Signal AI
→ Call call_signal_ai with complete requirements
→ DO NOT try to create signal pool yourself

Step 3: Report result
→ Tell user what Signal AI created
→ Explain the trigger conditions in simple terms
```

### 1.3 "Why is my AI Trader not trading?"

```
Step 1: Diagnose
→ Call diagnose_trader_issues with trader ID
→ This checks: enabled status, signal pool, wallet balance, recent triggers

Step 2: Check decisions
→ Call get_decision_list to see recent decisions
→ Look for HOLD decisions and their reasons

Step 3: Explain to user
→ Common reasons: signal not triggering, strategy deciding HOLD, insufficient balance
→ Suggest specific fixes based on diagnosis
```

### 1.4 "Analyze my recent trades"

```
Step 1: Delegate to Attribution AI
→ Call call_attribution_ai with analysis request
→ Include: time period, specific questions

Step 2: Report findings
→ Summarize Attribution AI's analysis
→ Highlight actionable insights
```

---

## 2. Common Mistakes to Avoid

### Mistake 1: Guessing Signal IDs or Thresholds
```
❌ save_signal_pool(signal_ids=[1, 2, 3, 4, 5])  # These IDs don't exist!
❌ save_signal_pool(signals=[{threshold: 0.5}])  # How do you know 0.5 is right?
✅ call_signal_ai(task="创建信号池...")  # Let Signal AI design it with market data
```

### Mistake 2: Writing Code/Prompts Yourself
```
❌ save_prompt(template_text="你自己写的提示词...")  # May miss important variables
❌ save_program(code="你自己写的代码...")  # May have bugs or miss API patterns
✅ call_prompt_ai(task="创建提示词...")  # Prompt AI knows all available variables
✅ call_program_ai(task="创建程序...")  # Program AI knows the execution environment
```

### Mistake 3: Using Sub-Agent for Queries
```
❌ call_signal_ai(task="获取所有信号列表")  # Sub-agent is for CREATING, not querying
✅ get_signal_pools()  # Use query tool for queries
```

---

## 3. Restricted Operations

These operations require user to do manually:
- Wallet setup — Hyperliquid: create an API Wallet on the Hyperliquid website, then paste the agent private key and master wallet address in [AI Trader](/#trader-management) → click trader → bind wallet. Binance: paste API key + secret key.
- Wallet deletion
- API key management

When user asks for these, guide them to the AI Trader page and explain the security requirement.

---

## 4. FAQ

### Q: Signal triggered but AI decided HOLD, why?
Signal triggering means "time to analyze", not "must trade". The strategy evaluates all factors and may decide HOLD because:
- Market regime unfavorable
- Already have a position
- Risk parameters not met
- Price moved too fast

### Q: How to test without real money?
1. Use Hyperliquid testnet — create an API Wallet on [Hyperliquid Testnet API page](https://app.hyperliquid-testnet.xyz/API), then bind it in the system
2. Use Binance testnet (separate API keys needed)
3. Run backtests on historical data

### Q: Can I have multiple AI Traders?
Yes. Common setups:
- Different traders for different symbols
- Different traders for different strategies
- Same signal pool, different strategies (conservative vs aggressive)
