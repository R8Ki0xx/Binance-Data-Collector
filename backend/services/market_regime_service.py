"""
Market Regime Classification Service

Classifies market conditions into 7 regime types:
1. Stop Hunt - Price spike through key level then reversal
2. Absorption - Strong flow but price doesn't move
3. Breakout - Trend initiation with aligned signals
4. Continuation - Trend continuation
5. Exhaustion - Trend exhaustion at extremes
6. Trap - Bull/bear trap (strong flow but OI decreasing)
7. Noise - No clear signal

Indicator definitions (per planning document):
- cvd_ratio: CVD / Total Notional (not z-score)
- taker_ratio: ln(buy_notional / sell_notional) - log transformation for symmetry
- oi_delta: OI change percentage
- price_atr: Price Change / ATR
- rsi: RSI14
"""

import math
import logging
from typing import Optional, Dict, Any, List, Tuple
from datetime import datetime
from sqlalchemy.orm import Session

from database.models import MarketRegimeConfig, CryptoKline, MarketTradesAggregated
from services.technical_indicators import calculate_indicators
from services.market_flow_indicators import get_flow_indicators_for_prompt, TIMEFRAME_MS

logger = logging.getLogger(__name__)


def fetch_ohlc_from_flow(
    db: Session,
    symbol: str,
    period: str,
    limit: int = 15,
    current_time_ms: Optional[int] = None,
    exchange: str = "hyperliquid"
) -> List[Dict[str, Any]]:
    """
    Aggregate OHLC data from 15-second flow data (MarketTradesAggregated).

    This function builds "simulated K-lines" using flow data, with current_time_ms
    as the anchor point. Each K-line covers one period sliding backwards.

    Args:
        db: Database session
        symbol: Trading symbol (e.g., "BTC")
        period: Timeframe ("1m", "5m", "15m", "1h")
        limit: Number of K-lines to generate (default 15 for ATR14/RSI14)
        current_time_ms: Anchor timestamp in milliseconds (defaults to now)
        exchange: Exchange name (e.g., "hyperliquid", "binance")

    Returns:
        List of OHLC dicts in chronological order (oldest first),
        same format as fetch_kline_data()
    """
    if current_time_ms is None:
        current_time_ms = int(datetime.utcnow().timestamp() * 1000)

    period_ms = TIMEFRAME_MS.get(period)
    if not period_ms:
        logger.warning(f"Unsupported period for flow aggregation: {period}")
        return []

    # Calculate query time range: need limit periods of data
    total_time_ms = limit * period_ms
    start_ts = current_time_ms - total_time_ms
    end_ts = current_time_ms

    # Query all 15-second records in the time range
    records = db.query(
        MarketTradesAggregated.timestamp,
        MarketTradesAggregated.vwap,
        MarketTradesAggregated.high_price,
        MarketTradesAggregated.low_price,
        MarketTradesAggregated.taker_buy_notional,
        MarketTradesAggregated.taker_sell_notional
    ).filter(
        MarketTradesAggregated.symbol == symbol.upper(),
        MarketTradesAggregated.exchange == exchange.lower(),
        MarketTradesAggregated.timestamp >= start_ts,
        MarketTradesAggregated.timestamp < end_ts
    ).order_by(MarketTradesAggregated.timestamp).all()

    if not records:
        logger.warning(f"No flow data for {symbol} in range [{start_ts}, {end_ts})")
        return []

    # Group records by period bucket
    buckets = {}  # bucket_start_ts -> list of records
    for rec in records:
        # Calculate which period bucket this record belongs to
        # Bucket is defined by: bucket_start = end_ts - (i+1)*period_ms to end_ts - i*period_ms
        # We use floor division to find the bucket index from the end
        time_from_end = end_ts - rec.timestamp
        bucket_idx = time_from_end // period_ms
        if bucket_idx >= limit:
            continue  # Outside our limit
        bucket_start = end_ts - (bucket_idx + 1) * period_ms
        if bucket_start not in buckets:
            buckets[bucket_start] = []
        buckets[bucket_start].append(rec)

    # Aggregate each bucket into OHLC
    result = []
    for i in range(limit - 1, -1, -1):  # Iterate from oldest to newest
        bucket_start = end_ts - (i + 1) * period_ms
        bucket_records = buckets.get(bucket_start, [])

        if not bucket_records:
            # No data for this period, skip or use placeholder
            continue

        # Sort by timestamp to get first/last
        bucket_records.sort(key=lambda x: x.timestamp)

        # Aggregate OHLC
        first_rec = bucket_records[0]
        last_rec = bucket_records[-1]

        open_price = float(first_rec.vwap) if first_rec.vwap else 0
        close_price = float(last_rec.vwap) if last_rec.vwap else 0
        high_price = max((float(r.high_price) for r in bucket_records if r.high_price), default=0)
        low_price = min((float(r.low_price) for r in bucket_records if r.low_price), default=0)
        volume = sum(
            (float(r.taker_buy_notional or 0) + float(r.taker_sell_notional or 0))
            for r in bucket_records
        )

        result.append({
            "timestamp": bucket_start // 1000,  # Convert to seconds for consistency
            "open": open_price,
            "high": high_price,
            "low": low_price,
            "close": close_price,
            "volume": volume
        })

    logger.debug(f"Aggregated {len(result)} OHLC bars from flow data for {symbol}/{period}")
    return result


def _fetch_kline_with_realtime(
    db: Session, symbol: str, period: str, limit: int, current_time_ms: Optional[int]
) -> List[Dict[str, Any]]:
    """
    Fetch K-line data with realtime API call for current candle.
    Merges API data with DB history, API data takes priority for overlapping timestamps.

    Args:
        db: Database session
        symbol: Trading symbol
        period: Timeframe (1m, 5m, 15m, etc.)
        limit: Number of candles to fetch
        current_time_ms: Current timestamp in milliseconds
    """
    from services.hyperliquid_market_data import get_kline_data_from_hyperliquid

    # Fetch recent candles from API (including current unfinished candle)
    api_klines = []
    try:
        # Only fetch 5 candles from API to minimize latency
        raw_data = get_kline_data_from_hyperliquid(symbol, period, count=5, persist=False)
        for k in raw_data:
            # API returns timestamp in ms, convert to seconds for consistency
            ts = k.get("timestamp", 0)
            if ts > 1e12:  # If in milliseconds
                ts = ts // 1000
            api_klines.append({
                "timestamp": ts,
                "open": float(k.get("open", 0)),
                "high": float(k.get("high", 0)),
                "low": float(k.get("low", 0)),
                "close": float(k.get("close", 0)),
                "volume": float(k.get("volume", 0))
            })
        logger.debug(f"Fetched {len(api_klines)} candles from API for {symbol}/{period}")
    except Exception as e:
        logger.warning(f"Failed to fetch realtime K-line from API: {e}, falling back to DB only")
        # Fallback to DB-only
        api_klines = []

    # Fetch history from DB (limit-5 to leave room for API data)
    db_limit = max(limit - 5, limit)  # Fetch enough to ensure we have limit candles after merge
    query = db.query(CryptoKline).filter(
        CryptoKline.symbol == symbol,
        CryptoKline.period == period
    )
    if current_time_ms:
        current_time_s = current_time_ms // 1000
        query = query.filter(CryptoKline.timestamp <= current_time_s)

    db_klines = query.order_by(CryptoKline.timestamp.desc()).limit(db_limit).all()

    # Convert DB klines to dict format
    db_data = {}
    for k in db_klines:
        db_data[k.timestamp] = {
            "timestamp": k.timestamp,
            "open": float(k.open_price) if k.open_price else 0,
            "high": float(k.high_price) if k.high_price else 0,
            "low": float(k.low_price) if k.low_price else 0,
            "close": float(k.close_price) if k.close_price else 0,
            "volume": float(k.volume) if k.volume else 0
        }

    # Merge: API data takes priority (more recent)
    for k in api_klines:
        db_data[k["timestamp"]] = k

    # Sort by timestamp and take last 'limit' candles
    sorted_klines = sorted(db_data.values(), key=lambda x: x["timestamp"])
    return sorted_klines[-limit:] if len(sorted_klines) > limit else sorted_klines


# Regime type constants
REGIME_STOP_HUNT = "stop_hunt"
REGIME_ABSORPTION = "absorption"
REGIME_BREAKOUT = "breakout"
REGIME_CONTINUATION = "continuation"
REGIME_EXHAUSTION = "exhaustion"
REGIME_TRAP = "trap"
REGIME_NOISE = "noise"

# Direction constants
DIRECTION_BULLISH = "bullish"
DIRECTION_BEARISH = "bearish"
DIRECTION_NEUTRAL = "neutral"


def get_default_config(db: Session) -> Optional[MarketRegimeConfig]:
    """Get default regime config from database"""
    return db.query(MarketRegimeConfig).filter(
        MarketRegimeConfig.is_default == True
    ).first()


def calculate_direction(cvd_ratio: float, taker_log_ratio: float, price_atr: float) -> str:
    """
    Calculate direction by voting: cvd + taker + price.
    Note: taker_log_ratio is already log-transformed, so >0 means bullish, <0 means bearish.
    """
    votes = 0
    if cvd_ratio > 0:
        votes += 1
    elif cvd_ratio < 0:
        votes -= 1
    if taker_log_ratio > 0:  # log(buy/sell) > 0 means buy > sell
        votes += 1
    elif taker_log_ratio < 0:
        votes -= 1
    if price_atr > 0:
        votes += 1
    elif price_atr < 0:
        votes -= 1

    if votes >= 2:
        return DIRECTION_BULLISH
    elif votes <= -2:
        return DIRECTION_BEARISH
    return DIRECTION_NEUTRAL


def calculate_confidence(
    cvd_ratio: float, taker_log_ratio: float, oi_delta: float, price_atr: float
) -> float:
    """Calculate base confidence score (0-1) based on signal strength"""
    # Normalize each indicator to 0-1 range
    # cvd_ratio: typical range -0.5 to 0.5, cap at 0.3
    # taker_log_ratio: typical range -1 to 1 (log scale)
    # oi_delta: typical range -5% to 5%
    # price_atr: typical range -2 to 2
    score = (
        0.3 * min(abs(cvd_ratio), 0.3) / 0.3 +
        0.2 * min(abs(taker_log_ratio), 1.0) / 1.0 +
        0.2 * min(abs(oi_delta), 5.0) / 5.0 +
        0.3 * min(abs(price_atr), 2.0) / 2.0
    )
    return max(0.0, min(1.0, score))


def calculate_pattern_penalty(
    regime: str,
    cvd_ratio: float,
    price_atr: float,
    oi_delta: float,
    rsi: float,
    price_range_atr: float
) -> float:
    """
    Calculate pattern penalty based on regime-specific feature matching.
    Returns multiplier 0.70-1.0 (1.0 = no penalty, <1.0 = penalty for mismatch).
    """
    score = 1.0

    cvd_weak = abs(cvd_ratio) < 0.03
    price_strong = abs(price_atr) > 0.5
    rsi_extreme = rsi > 70 or rsi < 30
    range_large = price_range_atr > 1.0
    body_ratio = abs(price_atr) / price_range_atr if price_range_atr > 0 else 1.0
    cvd_price_aligned = (cvd_ratio > 0 and price_atr > 0) or (cvd_ratio < 0 and price_atr < 0)

    if regime == REGIME_BREAKOUT:
        if not cvd_price_aligned:
            score -= 0.12  # CVD and price should be aligned for breakout
        if cvd_weak:
            score -= 0.08  # CVD should be strong for breakout

    elif regime == REGIME_ABSORPTION:
        if price_strong:
            score -= 0.10  # Price should be weak for absorption
        if cvd_weak:
            score -= 0.08  # CVD should be strong for absorption

    elif regime == REGIME_CONTINUATION:
        if not cvd_price_aligned:
            score -= 0.15  # CVD and price must be aligned for continuation

    elif regime == REGIME_EXHAUSTION:
        if not rsi_extreme:
            score -= 0.10  # RSI should be extreme for exhaustion

    elif regime == REGIME_TRAP:
        if cvd_price_aligned:
            score -= 0.12  # Trap should have CVD/price divergence

    elif regime == REGIME_STOP_HUNT:
        if not range_large:
            score -= 0.10  # Stop hunt needs large range
        if body_ratio > 0.5:
            score -= 0.08  # Stop hunt should have small body (reversal)

    elif regime == REGIME_NOISE:
        score -= 0.15  # Noise regime gets penalty

    return max(0.70, score)


def calculate_direction_penalty(
    regime: str,
    cvd_ratio: float,
    price_atr: float,
    taker_log_ratio: float
) -> float:
    """
    Calculate direction penalty based on CVD/Price/Taker alignment.
    Returns multiplier 0.85-1.0 (1.0 = no penalty, <1.0 = penalty for mismatch).
    """
    cvd_dir = 1 if cvd_ratio > 0.02 else (-1 if cvd_ratio < -0.02 else 0)
    price_dir = 1 if price_atr > 0.1 else (-1 if price_atr < -0.1 else 0)
    taker_dir = 1 if taker_log_ratio > 0.15 else (-1 if taker_log_ratio < -0.15 else 0)

    dirs = [d for d in [cvd_dir, price_dir, taker_dir] if d != 0]
    if len(dirs) < 2:
        return 1.0  # Insufficient data, no penalty

    all_aligned = all(d == dirs[0] for d in dirs)
    has_contradiction = (1 in dirs and -1 in dirs)

    # Breakout/Continuation: should have aligned directions
    if regime in [REGIME_BREAKOUT, REGIME_CONTINUATION]:
        if has_contradiction:
            return 0.85  # -15% penalty for direction contradiction

    # Absorption/Trap: expect divergence, penalize if all aligned
    elif regime in [REGIME_ABSORPTION, REGIME_TRAP]:
        if all_aligned:
            return 0.88  # -12% penalty for unexpected alignment

    elif regime == REGIME_NOISE:
        return 0.90  # -10% penalty for noise

    return 1.0


def classify_regime(
    cvd_ratio: float,
    taker_log_ratio: float,
    oi_delta: float,
    price_atr: float,
    rsi: float,
    price_range_atr: float,
    config: MarketRegimeConfig
) -> Tuple[str, str]:
    """
    Classify market regime based on indicators.
    Returns (regime_type, reason)

    Priority order:
    1. Stop Hunt - spike and reversal
    2. Breakout - strong CVD + price move + (Taker extreme OR OI increase)
    3. Exhaustion - strong CVD + OI decrease + RSI extreme
    4. Trap - strong CVD + OI decrease significantly
    5. Absorption - strong CVD but price doesn't move
    6. Continuation - CVD aligned with price movement
    7. Noise - no clear pattern

    Note: Taker thresholds should be set to capture ~25% as extreme.
    Default: taker_high=33, taker_low=0.03 (log threshold ±3.5)
    """
    # Thresholds from config
    cvd_strong = config.breakout_cvd_z * 0.1  # ~0.15 for strong flow
    cvd_divisor = config.continuation_cvd_divisor or 3.0
    cvd_weak = cvd_strong / cvd_divisor  # ~0.05 for weak flow
    price_breakout = config.breakout_price_atr + 0.2  # ~0.5 for breakout
    price_move = config.absorption_price_atr  # ~0.3 for movement
    oi_increase = config.breakout_oi_z  # OI increase threshold
    oi_decrease = config.trap_oi_z  # OI decrease threshold

    # Taker extreme check (using log thresholds)
    taker_high_log = math.log(config.breakout_taker_high) if config.breakout_taker_high > 0 else 3.5
    taker_low_log = math.log(config.breakout_taker_low) if config.breakout_taker_low > 0 else -3.5
    is_taker_extreme = taker_log_ratio > taker_high_log or taker_log_ratio < taker_low_log

    # Direction alignment check
    cvd_price_aligned = (cvd_ratio > 0 and price_atr > 0) or (cvd_ratio < 0 and price_atr < 0)

    # 1. Stop Hunt: large range but close near open (spike and reversal)
    if (price_range_atr > config.stop_hunt_range_atr and
        abs(price_atr) < config.stop_hunt_close_atr):
        return REGIME_STOP_HUNT, "Price spiked but closed near open"

    # 2. Breakout: strong CVD + price move + (Taker extreme OR OI increase)
    # Additional check: body must be significant portion of range (not spike-and-reverse)
    is_cvd_strong = abs(cvd_ratio) > cvd_strong
    is_price_breakout = abs(price_atr) > price_breakout
    is_oi_increase = oi_delta > oi_increase
    # Body ratio: if price spiked but reversed (long shadow), it's not a true breakout
    body_ratio = abs(price_atr) / price_range_atr if price_range_atr > 0 else 1.0
    body_ratio_threshold = config.breakout_body_ratio or 0.4
    is_solid_move = body_ratio > body_ratio_threshold  # Body must be > threshold of range

    if is_cvd_strong and is_price_breakout and cvd_price_aligned and is_solid_move and (is_taker_extreme or is_oi_increase):
        direction = "Bullish" if cvd_ratio > 0 else "Bearish"
        return REGIME_BREAKOUT, f"{direction} breakout with aligned signals"

    # 3. Exhaustion: strong CVD + OI decrease + RSI extreme
    is_oi_decrease = oi_delta < oi_decrease
    rsi_extreme = rsi > config.exhaustion_rsi_high or rsi < config.exhaustion_rsi_low

    if is_cvd_strong and is_oi_decrease and rsi_extreme:
        return REGIME_EXHAUSTION, "Trend exhaustion at RSI extreme"

    # 4. Trap: strong CVD + OI decrease + price reversal (close near open)
    if is_cvd_strong and is_oi_decrease and abs(price_atr) < config.stop_hunt_close_atr:
        return REGIME_TRAP, "Strong flow but positions closing with reversal (trap)"

    # 5. Absorption: strong CVD but price doesn't move
    is_price_move = abs(price_atr) > price_move
    if is_cvd_strong and not is_price_move:
        return REGIME_ABSORPTION, "Strong flow absorbed without price movement"

    # 6. Continuation: CVD aligned with price movement
    is_cvd_weak = abs(cvd_ratio) > cvd_weak
    if is_cvd_weak and is_price_move and cvd_price_aligned:
        direction = "Bullish" if cvd_ratio > 0 else "Bearish"
        return REGIME_CONTINUATION, f"{direction} trend continuation"

    # 7. Noise: no clear pattern
    return REGIME_NOISE, "No clear market regime detected"


def fetch_kline_data(
    db: Session, symbol: str, period: str = "5m", limit: int = 50,
    current_time_ms: Optional[int] = None, use_realtime: bool = False,
    exchange: str = "hyperliquid"
) -> List[Dict[str, Any]]:
    """
    Fetch K-line data for technical indicator calculation.
    Returns list of dicts with timestamp, open, high, low, close, volume.

    Args:
        db: Database session
        symbol: Trading symbol
        period: Timeframe (1m, 5m, 15m, etc.)
        limit: Number of candles to fetch
        current_time_ms: Optional timestamp for historical queries (backtesting)
        use_realtime: If True, use flow data aggregation for real-time regime calculation
        exchange: Exchange name (e.g., "hyperliquid", "binance")
    """
    # If use_realtime, aggregate OHLC from flow data (15-second buckets)
    # This provides real-time regime calculation without K-line close delay
    if use_realtime:
        return fetch_ohlc_from_flow(db, symbol, period, limit, current_time_ms, exchange=exchange)

    # Original DB-only logic for backtesting
    query = db.query(CryptoKline).filter(
        CryptoKline.symbol == symbol,
        CryptoKline.period == period,
        CryptoKline.exchange == exchange.lower()
    )

    if current_time_ms:
        # Convert ms to seconds for comparison with CryptoKline.timestamp (stored in seconds)
        current_time_s = current_time_ms // 1000
        query = query.filter(CryptoKline.timestamp <= current_time_s)

    klines = query.order_by(CryptoKline.timestamp.desc()).limit(limit).all()

    if not klines:
        return []

    # Reverse to chronological order and convert to dict format
    result = []
    for k in reversed(klines):
        result.append({
            "timestamp": k.timestamp,
            "open": float(k.open_price) if k.open_price else 0,
            "high": float(k.high_price) if k.high_price else 0,
            "low": float(k.low_price) if k.low_price else 0,
            "close": float(k.close_price) if k.close_price else 0,
            "volume": float(k.volume) if k.volume else 0
        })
    return result


def calculate_price_metrics(kline_data: List[Dict[str, Any]]) -> Dict[str, float]:
    """
    Calculate price-based metrics using technical indicators.
    Returns: price_atr, price_range_atr, rsi
    """
    if len(kline_data) < 15:  # Need at least 15 bars for ATR14 and RSI14
        return {"price_atr": 0.0, "price_range_atr": 0.0, "rsi": 50.0}

    # Calculate ATR and RSI using technical_indicators service
    indicators = calculate_indicators(kline_data, ["ATR14", "RSI14"])

    atr_values = indicators.get("ATR14", [])
    rsi_values = indicators.get("RSI14", [])

    # Get latest values
    atr = atr_values[-1] if atr_values else 0.0
    rsi = rsi_values[-1] if rsi_values else 50.0

    # Calculate price_atr: (close - open) / ATR (normalized price change)
    if atr > 0 and len(kline_data) >= 1:
        latest = kline_data[-1]
        price_change = latest["close"] - latest["open"]
        price_atr = price_change / atr
        # Calculate price_range_atr: (high - low) / ATR
        price_range = latest["high"] - latest["low"]
        price_range_atr = price_range / atr
    else:
        price_atr = 0.0
        price_range_atr = 0.0

    return {
        "price_atr": price_atr,
        "price_range_atr": price_range_atr,
        "rsi": rsi
    }


def get_market_regime(
    db: Session,
    symbol: str,
    timeframe: str = "5m",
    config_id: Optional[int] = None,
    timestamp_ms: Optional[int] = None,
    use_realtime: bool = False,
    exchange: str = "hyperliquid"
) -> Dict[str, Any]:
    """
    Main entry point: Get market regime classification for a symbol.

    IMPORTANT: This function reuses market_flow_indicators service for CVD, Taker, OI
    to ensure consistency with signal detection system.

    Args:
        db: Database session
        symbol: Trading pair symbol (e.g., "BTC")
        timeframe: Time frame (1m, 5m, 15m, 1h, etc.)
        config_id: Optional config ID, uses default if not specified
        timestamp_ms: Optional timestamp for historical queries (backtesting)
        use_realtime: If True, fetch current K-line from API for real-time triggers
        exchange: Exchange to use for data ("hyperliquid" or "binance")

    Returns:
        Dict with regime, direction, confidence, reason, indicators, and debug info
    """
    # Get config
    if config_id:
        config = db.query(MarketRegimeConfig).filter(
            MarketRegimeConfig.id == config_id
        ).first()
    else:
        config = get_default_config(db)

    if not config:
        return {
            "regime": REGIME_NOISE,
            "direction": DIRECTION_NEUTRAL,
            "confidence": 0.0,
            "reason": "No regime config found",
            "indicators": {},
            "debug": {}
        }

    # Validate timeframe
    if timeframe not in TIMEFRAME_MS:
        return {
            "regime": REGIME_NOISE,
            "direction": DIRECTION_NEUTRAL,
            "confidence": 0.0,
            "reason": f"Unsupported timeframe: {timeframe}",
            "indicators": {},
            "debug": {}
        }

    # Get current time if not specified
    if timestamp_ms is None:
        timestamp_ms = int(datetime.utcnow().timestamp() * 1000)

    # Fetch flow indicators using market_flow_indicators service (REUSE!)
    flow_data = get_flow_indicators_for_prompt(
        db, symbol, timeframe, ["CVD", "TAKER", "OI_DELTA"], timestamp_ms,
        exchange=exchange
    )

    cvd_data = flow_data.get("CVD")
    taker_data = flow_data.get("TAKER")
    oi_delta_data = flow_data.get("OI_DELTA")

    # Check if we have enough data
    if not cvd_data or not taker_data:
        return {
            "regime": REGIME_NOISE,
            "direction": DIRECTION_NEUTRAL,
            "confidence": 0.0,
            "reason": "Insufficient market flow data",
            "indicators": {},
            "debug": {"cvd_data": cvd_data, "taker_data": taker_data}
        }

    # Extract indicator values
    # CVD ratio: current CVD / total notional (buy + sell)
    cvd_current = cvd_data.get("current", 0) or 0
    taker_buy = taker_data.get("buy", 0)
    taker_sell = taker_data.get("sell", 0)
    total_notional = taker_buy + taker_sell

    cvd_ratio = cvd_current / total_notional if total_notional > 0 else 0.0

    # Taker log ratio: ln(buy/sell) for symmetry around 0
    if taker_buy > 0 and taker_sell > 0:
        taker_log_ratio = math.log(taker_buy / taker_sell)
    else:
        taker_log_ratio = 0.0

    # OI delta: percentage change
    oi_delta = oi_delta_data.get("current", 0) if oi_delta_data else 0.0

    # Fetch K-line data and calculate price metrics (ATR, RSI)
    kline_data = fetch_kline_data(
        db, symbol, timeframe, limit=50,
        current_time_ms=timestamp_ms, use_realtime=use_realtime,
        exchange=exchange
    )
    price_metrics = calculate_price_metrics(kline_data)
    price_atr = price_metrics["price_atr"]
    price_range_atr = price_metrics["price_range_atr"]
    rsi = price_metrics["rsi"]

    # Classify regime
    regime, reason = classify_regime(
        cvd_ratio, taker_log_ratio, oi_delta, price_atr, rsi, price_range_atr, config
    )

    # Calculate direction and confidence
    direction = calculate_direction(cvd_ratio, taker_log_ratio, price_atr)
    base_confidence = calculate_confidence(cvd_ratio, taker_log_ratio, oi_delta, price_atr)

    # Apply penalty multipliers for regime-specific quality assessment
    pattern_penalty = calculate_pattern_penalty(
        regime, cvd_ratio, price_atr, oi_delta, rsi, price_range_atr
    )
    direction_penalty = calculate_direction_penalty(
        regime, cvd_ratio, price_atr, taker_log_ratio
    )
    confidence = base_confidence * pattern_penalty * direction_penalty

    return {
        "regime": regime,
        "direction": direction,
        "confidence": round(confidence, 3),
        "reason": reason,
        "indicators": {
            "cvd_ratio": round(cvd_ratio, 4),  # CVD / Total Notional
            "oi_delta": round(oi_delta, 3),    # OI change percentage
            "taker_ratio": round(math.exp(taker_log_ratio), 3),  # buy/sell ratio
            "price_atr": round(price_atr, 3),
            "rsi": round(rsi, 1)
        },
        "debug": {
            "cvd_ratio": round(cvd_ratio, 4),
            "taker_log_ratio": round(taker_log_ratio, 4),
            "oi_delta_pct": round(oi_delta, 3),
            "taker_buy": round(taker_buy, 2),
            "taker_sell": round(taker_sell, 2),
            "total_notional": round(total_notional, 2),
            "timestamp_ms": timestamp_ms,
            "timeframe": timeframe
        }
    }
