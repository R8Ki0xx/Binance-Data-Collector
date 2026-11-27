"""
Factor Registry - Defines all available factors for the Factor System.

Each factor maps to an existing calculation function:
- technical: uses calculate_indicators() from technical_indicators.py
- microstructure: uses get_indicator_value() from market_flow_indicators.py
"""

# Category i18n mapping
CATEGORY_LABELS = {
    "momentum": {"en": "Momentum", "zh": "动量"},
    "trend": {"en": "Trend", "zh": "趋势"},
    "volatility": {"en": "Volatility", "zh": "波动率"},
    "volume": {"en": "Volume", "zh": "成交量"},
    "microstructure": {"en": "Microstructure", "zh": "微观结构"},
}

FACTOR_REGISTRY = [
    # ── Momentum ──
    {
        "name": "RSI14", "category": "momentum",
        "display_name": "RSI (14)", "display_name_zh": "RSI (14)",
        "description": "Relative Strength Index, 14-period",
        "description_zh": "相对强弱指数，14周期",
        "value_range": "0-100", "unit": "",
        "compute_type": "technical", "indicator_key": "RSI14",
    },
    {
        "name": "RSI7", "category": "momentum",
        "display_name": "RSI (7)", "display_name_zh": "RSI (7)",
        "description": "Relative Strength Index, 7-period",
        "description_zh": "相对强弱指数，7周期",
        "value_range": "0-100", "unit": "",
        "compute_type": "technical", "indicator_key": "RSI7",
    },
    {
        "name": "STOCH_K", "category": "momentum",
        "display_name": "Stochastic %K", "display_name_zh": "随机指标 %K",
        "description": "Stochastic Oscillator %K value",
        "description_zh": "随机振荡器 %K 值",
        "value_range": "0-100", "unit": "",
        "compute_type": "technical", "indicator_key": "STOCH", "extract": "k",
    },
    {
        "name": "STOCH_D", "category": "momentum",
        "display_name": "Stochastic %D", "display_name_zh": "随机指标 %D",
        "description": "Stochastic Oscillator %D value",
        "description_zh": "随机振荡器 %D 值",
        "value_range": "0-100", "unit": "",
        "compute_type": "technical", "indicator_key": "STOCH", "extract": "d",
    },
    {
        "name": "ROC10", "category": "momentum",
        "display_name": "ROC (10)", "display_name_zh": "变动率 (10)",
        "description": "Rate of Change, 10-period",
        "description_zh": "价格变动率，10周期",
        "value_range": "-∞ to +∞", "unit": "%",
        "compute_type": "derived", "derive_from": "close", "period_len": 10,
    },
    {
        "name": "ROC20", "category": "momentum",
        "display_name": "ROC (20)", "display_name_zh": "变动率 (20)",
        "description": "Rate of Change, 20-period",
        "description_zh": "价格变动率，20周期",
        "value_range": "-∞ to +∞", "unit": "%",
        "compute_type": "derived", "derive_from": "close", "period_len": 20,
    },

    # ── Trend ──
    {
        "name": "EMA20", "category": "trend",
        "display_name": "EMA (20)", "display_name_zh": "EMA (20)",
        "description": "Exponential Moving Average, 20-period deviation from price",
        "description_zh": "指数移动平均线，20周期价格偏离度",
        "value_range": "-1 to 1", "unit": "",
        "compute_type": "technical", "indicator_key": "EMA20",
        "normalize": "price_deviation",
    },
    {
        "name": "EMA50", "category": "trend",
        "display_name": "EMA (50)", "display_name_zh": "EMA (50)",
        "description": "Exponential Moving Average, 50-period deviation from price",
        "description_zh": "指数移动平均线，50周期价格偏离度",
        "value_range": "-1 to 1", "unit": "",
        "compute_type": "technical", "indicator_key": "EMA50",
        "normalize": "price_deviation",
    },
    {
        "name": "SMA20", "category": "trend",
        "display_name": "SMA (20)", "display_name_zh": "SMA (20)",
        "description": "Simple Moving Average, 20-period deviation from price",
        "description_zh": "简单移动平均线，20周期价格偏离度",
        "value_range": "-1 to 1", "unit": "",
        "compute_type": "technical", "indicator_key": "MA20",
        "normalize": "price_deviation",
    },
    {
        "name": "MACD_HIST", "category": "trend",
        "display_name": "MACD Histogram", "display_name_zh": "MACD 柱状图",
        "description": "MACD histogram value",
        "description_zh": "MACD 柱状图值",
        "value_range": "-∞ to +∞", "unit": "",
        "compute_type": "technical", "indicator_key": "MACD",
        "extract": "histogram",
    },
    {
        "name": "MACD_SIGNAL", "category": "trend",
        "display_name": "MACD Signal", "display_name_zh": "MACD 信号线",
        "description": "MACD signal line value",
        "description_zh": "MACD 信号线值",
        "value_range": "-∞ to +∞", "unit": "",
        "compute_type": "technical", "indicator_key": "MACD",
        "extract": "signal",
    },

    # ── Volatility ──
    {
        "name": "ATR14", "category": "volatility",
        "display_name": "ATR (14)", "display_name_zh": "ATR (14)",
        "description": "Average True Range, 14-period",
        "description_zh": "平均真实波幅，14周期",
        "value_range": "0 to +∞", "unit": "price",
        "compute_type": "technical", "indicator_key": "ATR14",
    },
    {
        "name": "BOLL_WIDTH", "category": "volatility",
        "display_name": "Bollinger Width", "display_name_zh": "布林带宽度",
        "description": "Bollinger Bands width (upper - lower) / middle",
        "description_zh": "布林带宽度 (上轨-下轨)/中轨",
        "value_range": "0 to +∞", "unit": "",
        "compute_type": "technical", "indicator_key": "BOLL",
        "extract": "width",
    },
    {
        "name": "BOLL_POSITION", "category": "volatility",
        "display_name": "Bollinger %B", "display_name_zh": "布林带 %B",
        "description": "Price position within Bollinger Bands (0-1)",
        "description_zh": "价格在布林带中的位置 (0-1)",
        "value_range": "0-1", "unit": "",
        "compute_type": "technical", "indicator_key": "BOLL",
        "extract": "percent_b",
    },

    # ── Volume ──
    {
        "name": "OBV", "category": "volume",
        "display_name": "OBV", "display_name_zh": "OBV 能量潮",
        "description": "On-Balance Volume",
        "description_zh": "能量潮指标",
        "value_range": "-∞ to +∞", "unit": "",
        "compute_type": "technical", "indicator_key": "OBV",
    },
    {
        "name": "VWAP_DEV", "category": "volume",
        "display_name": "VWAP Deviation", "display_name_zh": "VWAP 偏离度",
        "description": "Price deviation from VWAP",
        "description_zh": "价格相对 VWAP 的偏离度",
        "value_range": "-1 to 1", "unit": "",
        "compute_type": "technical", "indicator_key": "VWAP",
        "normalize": "price_deviation",
    },
    {
        "name": "VOLUME_SMA_RATIO", "category": "volume",
        "display_name": "Volume/SMA20 Ratio",
        "display_name_zh": "成交量/SMA20 比率",
        "description": "Current volume relative to 20-period SMA",
        "description_zh": "当前成交量与20周期均量的比率",
        "value_range": "0 to +∞", "unit": "x",
        "compute_type": "derived", "derive_from": "volume_ratio", "period_len": 20,
    },

    # ── Microstructure ──
    {
        "name": "CVD_RATIO", "category": "microstructure",
        "display_name": "CVD Ratio", "display_name_zh": "CVD 比率",
        "description": "Cumulative Volume Delta ratio",
        "description_zh": "累积成交量差值比率",
        "value_range": "-1 to 1", "unit": "",
        "compute_type": "microstructure", "indicator_key": "CVD",
    },
    {
        "name": "OI_CHANGE_PCT", "category": "microstructure",
        "display_name": "OI Change %", "display_name_zh": "持仓量变化%",
        "description": "Open Interest change percentage",
        "description_zh": "未平仓合约变化百分比",
        "value_range": "-∞ to +∞", "unit": "%",
        "compute_type": "microstructure", "indicator_key": "OI_DELTA",
    },
    {
        "name": "FUNDING_RATE", "category": "microstructure",
        "display_name": "Funding Rate", "display_name_zh": "资金费率",
        "description": "Current funding rate",
        "description_zh": "当前资金费率",
        "value_range": "-0.1% to 0.1%", "unit": "%",
        "compute_type": "microstructure", "indicator_key": "FUNDING",
    },
    {
        "name": "TAKER_BUY_RATIO", "category": "microstructure",
        "display_name": "Taker Buy Ratio", "display_name_zh": "主动买入比率",
        "description": "Taker buy volume ratio",
        "description_zh": "主动买入成交量占比",
        "value_range": "0-1", "unit": "",
        "compute_type": "microstructure", "indicator_key": "TAKER",
    },
    {
        "name": "DEPTH_RATIO", "category": "microstructure",
        "display_name": "Depth Ratio", "display_name_zh": "盘口深度比",
        "description": "Order book bid/ask depth ratio",
        "description_zh": "买卖盘口深度比率",
        "value_range": "0 to +∞", "unit": "",
        "compute_type": "microstructure", "indicator_key": "DEPTH",
    },
]


# Quick lookup by name
FACTOR_BY_NAME = {f["name"]: f for f in FACTOR_REGISTRY}

# All categories
FACTOR_CATEGORIES = sorted(set(f["category"] for f in FACTOR_REGISTRY))
