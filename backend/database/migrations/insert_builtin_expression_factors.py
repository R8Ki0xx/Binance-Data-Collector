"""
Insert 64 built-in expression-based factors into custom_factors table.

These extend the original 22 built-in factors (which use calculate_indicators path)
with expression engine-computed factors covering trend, momentum, volatility,
volume, statistical, and composite categories.

Idempotent: skips factors whose name already exists.
"""

import logging
from sqlalchemy import text

logger = logging.getLogger(__name__)


BUILTIN_FACTORS = [
    # ── Trend (10) ──
    ("EMA_CROSS_7_21", "EMA(close,7)/EMA(close,21)-1",
     "Short-term trend: EMA7/EMA21 ratio deviation", "trend"),
    ("EMA_CROSS_12_26", "EMA(close,12)/EMA(close,26)-1",
     "Mid-term trend: EMA12/EMA26 ratio deviation", "trend"),
    ("SMA_CROSS_10_30", "SMA(close,10)/SMA(close,30)-1",
     "Classic dual-MA crossover deviation", "trend"),
    ("DEMA20_DEV", "(close-DEMA(close,20))/close",
     "Double EMA deviation from price (low lag)", "trend"),
    ("HMA20_DEV", "(close-HMA(close,20))/close",
     "Hull MA deviation from price (minimal lag)", "trend"),
    ("KAMA20_DEV", "(close-KAMA(close,20))/close",
     "Kaufman Adaptive MA deviation (auto-adjusts in ranging markets)", "trend"),
    ("ADX14", "ADX(high,low,close,14)",
     "Average Directional Index: trend strength 0-100 (direction-agnostic)", "trend"),
    ("DI_SPREAD", "PLUS_DI(high,low,close,14)-MINUS_DI(high,low,close,14)",
     "Directional indicator spread: positive=bullish, negative=bearish", "trend"),
    ("AROON_OSC", "AROON_UP(high,low,25)-AROON_DOWN(high,low,25)",
     "Aroon Oscillator -100 to 100: trend direction and strength", "trend"),
    ("TREND_INTENSITY",
     "ADX(high,low,close,14)*SIGN(PLUS_DI(high,low,close,14)-MINUS_DI(high,low,close,14))",
     "Directional trend intensity: ADX with sign from DI spread", "trend"),

    # ── Momentum (9) ──
    ("CCI20", "CCI(high,low,close,20)",
     "Commodity Channel Index: mean-reversion signal, >100 overbought, <-100 oversold", "momentum"),
    ("WILLR14", "WILLR(high,low,close,14)",
     "Williams %R: -100 to 0, <-80 oversold, >-20 overbought", "momentum"),
    ("PPO_12_26", "PPO(close,12,26)",
     "Percentage Price Oscillator: normalized MACD as percentage", "momentum"),
    ("TRIX15", "TRIX(close,15)",
     "Triple-smoothed EMA rate of change: filters noise, shows momentum", "momentum"),
    ("MOM10_NORM", "MOM(close,10)/close",
     "Normalized momentum: 10-period price change as fraction of price", "momentum"),
    ("ROC5", "ROC(close,5)",
     "Short-term Rate of Change: 5-period percentage change", "momentum"),
    ("RSI21", "RSI(close,21)",
     "Long-period RSI: smoother, less false signals", "momentum"),
    ("MOM_ACCEL", "ROC(close,3)-ROC(close,10)",
     "Momentum acceleration: short ROC minus long ROC, positive=accelerating", "momentum"),
    ("RSI_CHANGE", "RSI(close,14)-DELAY(RSI(close,14),5)",
     "RSI 5-bar change: captures momentum shifts", "momentum"),

    # ── Volatility (8) ──
    ("NATR14", "NATR(high,low,close,14)",
     "Normalized ATR as % of close: comparable across symbols", "volatility"),
    ("ATR_RATIO", "ATR(high,low,close,5)/ATR(high,low,close,20)",
     "Volatility expansion/contraction: >1 expanding, <1 contracting", "volatility"),
    ("REALIZED_VOL", "STDDEV(LOG_RETURN(close,1),20)",
     "20-bar realized volatility (academic standard)", "volatility"),
    ("TR_PCT", "TRUE_RANGE(high,low,close)/close",
     "Single-bar true range as fraction of price", "volatility"),
    ("CLOSE_RANGE", "(close-low)/(high-low+0.0001)",
     "Close position within bar range: 0=at low, 1=at high", "volatility"),
    ("VOL_EXPANSION", "STDDEV(close,5)/STDDEV(close,20)",
     "Short/long stddev ratio: >1 means volatility increasing", "volatility"),
    ("BOLL_SQUEEZE", "(BBANDS_UPPER(close,20)-BBANDS_LOWER(close,20))/BBANDS_MID(close,20)",
     "Bollinger Band width: low values signal impending breakout", "volatility"),
    ("HIGH_LOW_PCT", "(high-low)/close",
     "Intra-bar range as percentage of close", "volatility"),

    # ── Volume (6) ──
    ("CMF20", "CMF(high,low,close,volume,20)",
     "Chaikin Money Flow -1 to 1: positive=buying pressure", "volume"),
    ("MFI14", "MFI(high,low,close,volume,14)",
     "Money Flow Index 0-100: volume-weighted RSI", "volume"),
    ("AD_LINE", "AD(high,low,close,volume)",
     "Accumulation/Distribution Line", "volume"),
    ("VOL_RATIO_5_20", "SMA(volume,5)/SMA(volume,20)",
     "Short/long volume ratio: >1 means increasing volume", "volume"),
    ("PRICE_VOL_CORR", "TS_CORR(close,volume,20)",
     "Price-volume correlation: negative=divergence", "volume"),
    ("VOL_TREND", "EMA(volume,7)/EMA(volume,21)-1",
     "Volume trend: positive=increasing participation", "volume"),

    # ── Statistical / Time Series (10) ──
    ("NORM_PRICE", "NORMALIZE(close,20)",
     "Rolling Z-score of price: mean-reversion core factor", "statistical"),
    ("RETURN_SKEW", "TS_SKEW(close,20)",
     "Return distribution skewness: positive=upside potential", "statistical"),
    ("RETURN_KURT", "TS_KURT(close,20)",
     "Return kurtosis: high=fat tails, extreme moves likely", "statistical"),
    ("PRICE_POS_20",
     "(close-TS_MIN(low,20))/(TS_MAX(high,20)-TS_MIN(low,20)+0.0001)",
     "Position within 20-bar high-low channel: 0=bottom, 1=top", "statistical"),
    ("BARS_FROM_HIGH", "TS_ARGMAX(high,20)",
     "Bars since 20-period high: 0=new high, high=extended decline", "statistical"),
    ("BARS_FROM_LOW", "TS_ARGMIN(low,20)",
     "Bars since 20-period low: 0=new low, high=extended rally", "statistical"),
    ("DECAY_MOM", "DECAYLINEAR(ROC(close,1),10)",
     "Linear-decay weighted momentum: recent bars weighted more", "statistical"),
    ("LOG_RETURN_1", "LOG_RETURN(close,1)",
     "Single-period log return", "statistical"),
    ("NORM_VOLUME", "NORMALIZE(volume,20)",
     "Volume Z-score: detects abnormal volume spikes", "statistical"),
    ("MOMENTUM_DECAY", "DECAYLINEAR(close,20)/SMA(close,20)-1",
     "Decay-weighted price vs SMA: recent-biased trend signal", "statistical"),

    # ── Composite / Converted (21) ──
    ("ICHIMOKU_CONV_DEV",
     "(close-(TS_MAX(high,9)+TS_MIN(low,9))/2)/close",
     "Ichimoku conversion line deviation from price", "composite"),
    ("ICHIMOKU_BASE_DEV",
     "(close-(TS_MAX(high,26)+TS_MIN(low,26))/2)/close",
     "Ichimoku base line deviation from price", "composite"),
    ("ICHIMOKU_SPAN",
     "((TS_MAX(high,9)+TS_MIN(low,9))/2-(TS_MAX(high,26)+TS_MIN(low,26))/2)/close",
     "Ichimoku conversion-base spread: positive=bullish", "composite"),
    ("DONCHIAN_POS",
     "(close-TS_MIN(low,20))/(TS_MAX(high,20)-TS_MIN(low,20)+0.0001)",
     "Donchian channel position: 0=bottom, 1=top", "composite"),
    ("KELTNER_POS",
     "(close-EMA(close,20))/(ATR(high,low,close,14)*2+0.0001)",
     "Keltner channel position: >1 above upper band", "composite"),
    ("PIVOT_DIST", "(close-(high+low+close)/3)/close",
     "Distance from pivot point as fraction of price", "composite"),
    ("EMA200_DEV", "(close-EMA(close,200))/close",
     "Long-term trend: deviation from 200-period EMA", "composite"),
    ("SMA50_DEV", "(close-SMA(close,50))/close",
     "Mid-term deviation from 50-period SMA", "composite"),
    ("WMA14_DEV", "(close-WMA(close,14))/close",
     "Weighted MA deviation from price", "composite"),
    ("TEMA20_DEV", "(close-TEMA(close,20))/close",
     "Triple EMA deviation: very responsive trend signal", "composite"),
    ("RSI_ZONE", "ABS(RSI(close,14)-50)",
     "RSI distance from neutral: 0=neutral, 50=extreme", "composite"),
    ("CCI_NORM", "CCI(high,low,close,20)/100",
     "Normalized CCI: easier threshold setting", "composite"),
    ("MFI_RSI_DIFF", "MFI(high,low,close,volume,14)-RSI(close,14)",
     "Volume-weighted RSI minus price RSI: detects volume-price divergence", "composite"),
    ("VOL_PRICE_DIV", "SIGN(ROC(close,5))*(-1)*ROC(volume,5)/100",
     "Volume-price divergence: positive when price up but volume down", "composite"),
    ("UP_VOL_RATIO",
     "TS_SUM(IF(ROC(close,1)>0,volume,0),20)/TS_SUM(volume,20)",
     "Fraction of volume on up-bars: >0.5=bullish participation", "composite"),
    ("EFFICIENCY_RATIO",
     "ABS(close-DELAY(close,10))/(TS_SUM(ABS(close-DELAY(close,1)),10)+0.0001)",
     "Price efficiency 0-1: 1=perfect trend, 0=choppy/range", "composite"),
    ("AMIHUD_ILLIQ", "ABS(ROC(close,1))/(volume+0.0001)",
     "Amihud illiquidity: high=large price impact per unit volume", "composite"),
    ("INTRABAR_VOL", "(high-low)/(ABS(close-open)+0.0001)",
     "Intra-bar volatility vs body: high=indecision/wicks", "composite"),
    ("SHADOW_UPPER", "(high-MAX(open,close))/(high-low+0.0001)",
     "Upper shadow ratio 0-1: high=rejection at top", "composite"),
    ("BODY_RATIO", "ABS(close-open)/(high-low+0.0001)",
     "Candle body ratio 0-1: high=strong conviction", "composite"),
    ("SHADOW_LOWER", "(MIN(open,close)-low)/(high-low+0.0001)",
     "Lower shadow ratio 0-1: high=buying at bottom", "composite"),
]


def upgrade():
    """Insert builtin expression factors. Idempotent."""
    from database.connection import SessionLocal

    db = SessionLocal()
    try:
        inserted = 0
        skipped = 0

        for name, expression, description, category in BUILTIN_FACTORS:
            exists = db.execute(
                text("SELECT 1 FROM custom_factors WHERE name = :name"),
                {"name": name}
            ).fetchone()

            if exists:
                skipped += 1
                continue

            db.execute(
                text("""
                    INSERT INTO custom_factors (name, expression, description, category, source, is_active)
                    VALUES (:name, :expression, :description, :category, 'builtin_expression', true)
                """),
                {"name": name, "expression": expression,
                 "description": description, "category": category}
            )
            inserted += 1

        db.commit()
        logger.info(f"[Migration] insert_builtin_expression_factors: "
                    f"inserted={inserted}, skipped={skipped}")

    except Exception as e:
        db.rollback()
        logger.error(f"[Migration] insert_builtin_expression_factors failed: {e}")
    finally:
        db.close()
