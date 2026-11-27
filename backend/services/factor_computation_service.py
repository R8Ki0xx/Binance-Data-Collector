"""
Factor Computation Service

Periodically computes factor values for all active symbols and writes
them to the factor_values table. Reuses existing indicator services.
Supports both Hyperliquid and Binance exchanges.
"""

import logging
import time
from typing import List, Optional, Dict

from sqlalchemy.orm import Session
from sqlalchemy import text

from database.connection import SessionLocal
from database.models import FactorValue
from services.factor_registry import FACTOR_REGISTRY
from services.factor_data_provider import ensure_kline_coverage
from services.technical_indicators import calculate_indicators
from services.scheduler import task_scheduler

logger = logging.getLogger(__name__)


class FactorComputationService:
    def __init__(self):
        self._running = False
        self._last_compute_time: Dict[str, float] = {}
        self._progress: Dict = {"status": "idle"}

    # ── public API ──

    def start(self):
        """Register periodic computation tasks via the scheduler."""
        if self._running:
            return
        self._running = True
        task_scheduler.add_interval_task(
            task_func=self._run_all,
            interval_seconds=3600,
            task_id="factor_computation_1h",
        )
        print("[FactorEngine] Scheduled factor computation (1h)", flush=True)

    def stop(self):
        self._running = False

    def get_last_compute_time(self, exchange: str) -> Optional[float]:
        return self._last_compute_time.get(exchange)

    def get_progress(self) -> Dict:
        return dict(self._progress)

    def get_symbols(self, exchange: str) -> List[str]:
        """Return watchlist symbols for estimation."""
        db: Session = SessionLocal()
        try:
            return self._get_symbols_for_exchange(db, exchange)
        finally:
            db.close()

    def compute_now(self, exchange: str = "hyperliquid", period: str = "1h"):
        """Manual trigger: compute factors for one exchange immediately."""
        db: Session = SessionLocal()
        try:
            symbols = self._get_symbols_for_exchange(db, exchange)
            if not symbols:
                self._progress = {"status": "idle"}
                return {"computed": 0, "exchange": exchange}
            total = len(symbols)
            self._progress = {
                "status": "running", "phase": "values",
                "completed": 0, "total": total, "current_symbol": "",
            }
            count = 0
            for i, symbol in enumerate(symbols):
                self._progress["current_symbol"] = symbol
                self._progress["completed"] = i
                try:
                    self._compute_for_symbol(db, symbol, period, exchange)
                    count += 1
                except Exception as e:
                    logger.warning(f"[FactorEngine] {exchange}/{symbol} err: {e}")
            self._progress = {"status": "idle"}
            self._last_compute_time[exchange] = time.time()
            return {"computed": count, "exchange": exchange}
        finally:
            db.close()

    # ── internal ──

    def _run_all(self):
        """Compute factors for every active symbol on all exchanges."""
        db: Session = SessionLocal()
        try:
            for exchange in ["hyperliquid", "binance"]:
                symbols = self._get_symbols_for_exchange(db, exchange)
                if not symbols:
                    continue
                for symbol in symbols:
                    try:
                        self._compute_for_symbol(db, symbol, "1h", exchange)
                    except Exception as e:
                        logger.warning(f"[FactorEngine] {exchange}/{symbol}/1h: {e}")
                self._last_compute_time[exchange] = time.time()
        finally:
            db.close()

    def _get_symbols_for_exchange(self, db: Session, exchange: str) -> List[str]:
        """Get watchlist symbols for the given exchange."""
        try:
            if exchange == "binance":
                from services.binance_symbol_service import get_selected_symbols
            else:
                from services.hyperliquid_symbol_service import get_selected_symbols
            return get_selected_symbols()
        except Exception:
            # Fallback: query kline table
            rows = db.execute(text(
                "SELECT DISTINCT symbol FROM crypto_klines "
                "WHERE exchange = :ex LIMIT 50"
            ), {"ex": exchange}).fetchall()
            return [r[0] for r in rows]

    def _compute_for_symbol(
        self, db: Session, symbol: str, period: str,
        exchange: str = "hyperliquid",
    ):
        """Compute all factors for one symbol/period and upsert."""
        klines = ensure_kline_coverage(db, exchange, symbol, period)
        if not klines or len(klines) < 20:
            return

        now_ts = int(klines[-1].get("timestamp", time.time()))

        # Batch-compute technical indicators
        tech_keys = list({
            f["indicator_key"]
            for f in FACTOR_REGISTRY
            if f["compute_type"] == "technical"
        })
        indicators = calculate_indicators(klines, tech_keys)

        rows_to_upsert: list = []

        for factor_def in FACTOR_REGISTRY:
            value = self._extract_value(
                factor_def, indicators, klines, db, symbol, period, exchange,
            )
            if value is None:
                continue
            rows_to_upsert.append({
                "exchange": exchange,
                "symbol": symbol,
                "period": period,
                "factor_name": factor_def["name"],
                "factor_category": factor_def["category"],
                "timestamp": now_ts,
                "value": float(value),
            })

        # Compute custom factors via expression engine
        custom_rows = self._compute_custom_factors(db, klines, now_ts, symbol, period, exchange)
        rows_to_upsert.extend(custom_rows)

        if not rows_to_upsert:
            return

        self._bulk_upsert(db, rows_to_upsert)
        print(f"[FactorEngine] {symbol}/{period}: wrote {len(rows_to_upsert)} factors ({len(custom_rows)} custom)", flush=True)

    def _extract_value(self, factor_def, indicators, klines, db, symbol, period, exchange):
        """Extract a single factor value from computed indicators or microstructure."""
        ctype = factor_def["compute_type"]

        if ctype == "technical":
            key = factor_def["indicator_key"]
            raw = indicators.get(key)
            if raw is None:
                return None
            return self._extract_technical(factor_def, raw, klines)

        if ctype == "microstructure":
            return self._extract_microstructure(factor_def, db, symbol, period, exchange)

        if ctype == "derived":
            return self._extract_derived(factor_def, klines)

        return None

    def _extract_technical(self, factor_def, raw, klines):
        """Get the latest value from a technical indicator result."""
        extract_key = factor_def.get("extract")
        normalize = factor_def.get("normalize")

        if isinstance(raw, dict):
            if extract_key == "width" and "upper" in raw and "middle" in raw and "lower" in raw:
                u, m, l = raw["upper"], raw["middle"], raw["lower"]
                if u and m and l and m[-1] != 0:
                    return (u[-1] - l[-1]) / m[-1]
                return None
            if extract_key == "percent_b" and "upper" in raw and "lower" in raw:
                u, l = raw["upper"], raw["lower"]
                close = float(klines[-1]["close"]) if klines else None
                if u and l and close and (u[-1] - l[-1]) != 0:
                    return (close - l[-1]) / (u[-1] - l[-1])
                return None
            if extract_key and extract_key in raw:
                series = raw[extract_key]
                return series[-1] if series else None
            if extract_key == "k" and "k" not in raw:
                for k_key in ("STOCHk", "k", "%K"):
                    if k_key in raw:
                        return raw[k_key][-1] if raw[k_key] else None
            if extract_key == "d" and "d" not in raw:
                for d_key in ("STOCHd", "d", "%D"):
                    if d_key in raw:
                        return raw[d_key][-1] if raw[d_key] else None
            return None

        if isinstance(raw, list) and raw:
            val = raw[-1]
            if normalize == "price_deviation" and klines:
                close = float(klines[-1]["close"])
                if close != 0:
                    return (close - val) / close
            return val
        return None

    def _extract_microstructure(self, factor_def, db, symbol, period, exchange):
        """Get value from market flow indicators."""
        try:
            from services.market_flow_indicators import get_indicator_value
            return get_indicator_value(
                db, symbol, factor_def["indicator_key"], period, exchange=exchange,
            )
        except Exception:
            return None

    def _extract_derived(self, factor_def, klines):
        """Compute derived factors directly from kline data."""
        derive = factor_def.get("derive_from")
        plen = factor_def.get("period_len", 10)

        if derive == "close" and len(klines) > plen:
            cur = float(klines[-1]["close"])
            prev = float(klines[-1 - plen]["close"])
            if prev != 0:
                return (cur - prev) / prev
        if derive == "volume_ratio" and len(klines) > plen:
            vols = [float(k["volume"]) for k in klines[-plen:]]
            avg = sum(vols) / len(vols) if vols else 0
            if avg != 0:
                return float(klines[-1]["volume"]) / avg
        return None

    def _compute_custom_factors(self, db: Session, klines, now_ts, symbol, period, exchange):
        """Compute active custom factors using expression engine."""
        from database.models import CustomFactor
        from services.factor_expression_engine import factor_expression_engine

        rows = []
        try:
            custom_factors = db.query(CustomFactor).filter(CustomFactor.is_active == True).all()
        except Exception:
            return rows

        for cf in custom_factors:
            try:
                series, err = factor_expression_engine.execute(cf.expression, klines)
                if series is None or len(series) == 0:
                    continue
                import pandas as pd
                last_val = series.iloc[-1]
                if pd.isna(last_val):
                    continue
                rows.append({
                    "exchange": exchange,
                    "symbol": symbol,
                    "period": period,
                    "factor_name": cf.name,
                    "factor_category": "custom",
                    "timestamp": now_ts,
                    "value": float(last_val),
                })
            except Exception as e:
                logger.warning(f"[FactorEngine] custom factor '{cf.name}' err: {e}")
        return rows

    def _bulk_upsert(self, db: Session, rows: list):
        """Upsert factor values using ON CONFLICT DO UPDATE."""
        if not rows:
            return
        sql = text("""
            INSERT INTO factor_values
                (exchange, symbol, period, factor_name, factor_category, timestamp, value)
            VALUES
                (:exchange, :symbol, :period, :factor_name, :factor_category, :timestamp, :value)
            ON CONFLICT (exchange, symbol, period, factor_name, timestamp)
            DO UPDATE SET value = EXCLUDED.value
        """)
        db.execute(sql, rows)
        db.commit()


# Singleton
factor_computation_service = FactorComputationService()
