---
name: factor-mining
shortcut: factor
description: Guide user through factor research and mining. Trigger when user asks to "find effective factors", "mine factors", "research alpha factors", "help me design a factor", "factor analysis", or similar requests about discovering new trading factors.
description_zh: 引导用户进行因子研究与挖掘，包括假设生成、表达式构建、有效性评估和因子保存。
---

# Factor Mining Workflow

Guide the user through discovering, testing, and saving effective trading factors.

## Pre-requisites (MUST confirm)

1. Which **exchange** to analyze (Hyperliquid or Binance)
2. Which **symbol(s)** to focus on (e.g., BTC, ETH)
3. What **trading style** or hypothesis they have in mind (optional)

## Workflow

### Phase 1: Survey Existing Factors

Use `query_factors` to check what's already computed:
- Show top factors ranked by |ICIR| for the target symbol
- Highlight factors with |ICIR| > 1.5 (strong) or |IC| > 0.05 (meaningful)
- Note which categories are well-covered vs under-explored

**[CHECKPOINT]** Present existing factor landscape. Ask user:
- Any patterns they notice?
- Which direction to explore (momentum, volatility, microstructure, custom)?

### Phase 2: Hypothesis Generation

**IMPORTANT: Call `get_factor_functions` first** to get the full list of available functions and their signatures. Do NOT guess function names or signatures — always check the registry.

Based on user's interest, generate 2-3 factor hypotheses:

**Approach A: Expression-based (no web search needed)**
- Combine existing indicators in new ways
- Common patterns: ratio (EMA7/EMA21-1), acceleration (ROC3-ROC10), normalized deviation ((close-SMA20)/STDDEV(close,20))
- Cross-category combinations (momentum + volatility, trend + volume)

**Approach B: Research-driven (use web_search + fetch_url)**
- If user wants inspiration from academic research, known factor libraries, or quant blogs
- **Step 1: Search for sources** — prioritize academic and code repositories:
  - For known factor sets (e.g., WorldQuant 101 Alphas): `site:github.com WorldQuant alpha101 formula` or `site:arxiv.org 101 Formulaic Alphas`
  - For specific factor numbers: `site:github.com "Alpha#101" formula`
  - For general quant research: `site:arxiv.org cryptocurrency momentum factor`
- **Step 2: Fetch full content** — use `fetch_url` on the most promising URL to read the actual formula/paper
- **Step 3: Translate to expression** — convert the retrieved formula into a factor expression compatible with our system
- Do NOT repeatedly search with different keywords hoping snippets contain the answer

**[CHECKPOINT]** Present hypotheses with rationale. Let user pick which to test.

### Phase 3: Test & Evaluate

For each chosen hypothesis:
1. Use `evaluate_factor` with the expression + target symbol
2. Interpret results:
   - **ICIR > 2.0**: Very strong predictive power
   - **ICIR 1.0-2.0**: Moderate, worth exploring
   - **ICIR < 0.5**: Weak, likely noise
   - **Win rate > 55%**: Directionally useful
   - Check across forward periods (1h/4h/12h/24h) for decay pattern
3. Compare with existing built-in factors — is the new factor adding value?

**[CHECKPOINT]** Present evaluation results in a comparison table. Recommend which factors to keep.

### Phase 4: Save & Compute

For factors that pass evaluation:
1. Use `save_factor` with a descriptive name and clear description
2. Use `compute_factor` to run full evaluation across all watchlist symbols
3. Suggest the user visit [Factor Library](/#factor-library) to view results

**[CHECKPOINT]** Summarize what was saved. Suggest next steps:
- Test more variations of successful factors
- Consider how to integrate into trading strategy (Phase 3-4 of factor system)
- Set up periodic re-evaluation

## Tips for the AI

- Always call `get_factor_functions` before writing any expression
- Always use English for web search queries (better results)
- When comparing factors, use a markdown table for clarity
- Explain IC/ICIR/win_rate in plain language for less experienced users
- If a factor has high IC but low ICIR, explain it means inconsistent signal
- Suggest testing both the factor and its negation (multiply by -1)
