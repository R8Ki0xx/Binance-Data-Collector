"""
Factor Effectiveness Service

Computes IC (Information Coefficient) time series using sliding window approach.
For each factor, slides a 30-day (720-bar) window over full K-line history,
computing IC at each daily position. This produces a complete historical IC
time series immediately — no need to wait for daily accumulation.

Architecture:
  - _compute_factor_windowed(): Core method. Slides 720-bar window with 24-bar step.
    Each window produces one IC value via fast numpy rank correlation (_calc_ic_fast).
    ICIR is computed ACROSS windows (trailing 30-day mean(IC)/std(IC)), which is
    the standard quant definition. Supports force mode (full overwrite) for manual
    compute and incremental mode (skip existing dates) for daily cron.
  - _compute_symbol(): Computes ALL factors for one symbol. Reports per-factor progress.
  - compute_single_factor(): Computes ONE factor across all symbols (Hyper AI tool).

Performance history (2026-03):
  v1: One-shot _calc_metrics with scipy.spearmanr + pandas rolling IC per window.
      147K calls × 5ms = 15 minutes for full compute. Bottleneck was rolling IC
      within each 720-bar window — redundant in sliding window mode where ICIR
      should be computed across windows, not within.
  v2 (current): _calc_ic_fast using pure numpy rank correlation per window (~0.05ms).
      ICIR computed as trailing cross-window mean(IC)/std(IC). Full compute ~30-60s.
      More standard quant approach AND 100x faster per call.

Runs daily via CronTrigger at UTC 01:00, also callable on-demand.
"""

import logging
import time
from datetime import date, datetime, timezone, timedelta
from typing import List, Dict, Optional, Tuple

import numpy as np
from sqlalchemy.orm import Session
from sqlalchemy import text

from database.connection import SessionLocal
from services.factor_registry import FACTOR_REGISTRY
from services.technical_indicators import calculate_indicators
from services.scheduler import task_scheduler

logger = logging.getLogger(__name__)


class FactorEffectivenessService:
    def __init__(self):
        self._running = False
        self._progress: Dict = {"status": "idle"}

    def start(self):
        if self._running:
            return
        self._running = True
        from apscheduler.triggers.cron import CronTrigger
        task_scheduler.scheduler.add_job(
            func=self._run,
            trigger=CronTrigger(hour=1, minute=0),
            id="factor_effectiveness_daily",
            replace_existing=True,
            max_instances=1, coalesce=True,
        )
        print("[FactorEffectiveness] Scheduled daily at UTC 01:00", flush=True)

    def stop(self):
        self._running = False

    def _run(self):
        db: Session = SessionLocal()
        try:
            for ex in ["hyperliquid", "binance"]:
                self.compute_for_exchange(db, ex)
        except Exception as e:
            logger.error(f"[FactorEffectiveness] error: {e}")
        finally:
            db.close()

    def get_progress(self) -> Dict:
        return dict(self._progress)

    def compute_for_exchange(self, db: Session, exchange: str, period: str = "1h",
                             force: bool = False):
        """Compute effectiveness for all factors on one exchange.

        Args:
            force: If True, recompute ALL windows (overwrites existing data via
                   ON CONFLICT DO UPDATE). Used by manual compute button.
                   If False, skip existing calc_dates (daily cron incremental mode).
        """
        symbols = self._get_symbols(db, exchange)
        if not symbols:
            self._progress = {"status": "idle"}
            return {"computed": 0, "exchange": exchange}
        total = len(symbols)
        self._progress = {
            "status": "running", "phase": "effectiveness",
            "symbol_completed": 0, "symbol_total": total,
            "current_symbol": "", "current_factor": "",
            "factor_completed": 0, "factor_total": 0,
        }
        count = 0
        for i, symbol in enumerate(symbols):
            self._progress["current_symbol"] = symbol
            self._progress["symbol_completed"] = i
            try:
                n = self._compute_symbol(db, exchange, symbol, period, force)
                count += n
            except Exception as e:
                logger.warning(f"[FactorEffectiveness] {exchange}/{symbol}: {e}")
        db.commit()
        self._progress = {"status": "idle"}
        print(f"[FactorEffectiveness] {exchange}: {count} records", flush=True)
        return {"computed": count, "exchange": exchange}

    def compute_single_factor(self, db: Session, exchange: str, factor_name: str) -> dict:
        """Public API: Compute one factor across all watchlist symbols.
        Called by Hyper AI's compute_factor tool. Always force=True to ensure
        latest algorithm is applied (overwrites old data via ON CONFLICT).
        """
        import pandas as pd
        from database.models import CustomFactor
        from services.factor_expression_engine import factor_expression_engine
        from services.factor_data_provider import ensure_kline_coverage

        builtin_def = next((f for f in FACTOR_REGISTRY if f["name"] == factor_name), None)
        custom_factor = None
        if not builtin_def:
            custom_factor = db.query(CustomFactor).filter(
                CustomFactor.name == factor_name, CustomFactor.is_active == True
            ).first()
            if not custom_factor:
                return {"error": f"Factor '{factor_name}' not found"}

        symbols = self._get_symbols(db, exchange)
        if not symbols:
            return {"error": f"No watchlist symbols for {exchange}"}

        computed = 0
        icir_values = []

        for symbol in symbols:
            klines = ensure_kline_coverage(db, exchange, symbol, "1h")
            if not klines or len(klines) < 50:
                continue

            n_bars = len(klines)
            closes = [float(k["close"]) for k in klines]

            if custom_factor:
                series, err = factor_expression_engine.execute(custom_factor.expression, klines)
                if series is None:
                    continue
                fvals = [None if pd.isna(v) else float(v) for v in series.tolist()]
                category = custom_factor.category or "custom"
            else:
                tech_keys = list({f["indicator_key"] for f in FACTOR_REGISTRY
                                  if f["compute_type"] == "technical"})
                indicators = calculate_indicators(klines, tech_keys)
                fvals = self._extract_full_series(
                    builtin_def, indicators, klines, n_bars, db, symbol, exchange)
                if fvals is None:
                    continue
                category = builtin_def["category"]

            n = self._compute_factor_windowed(
                db, exchange, factor_name, category, symbol, "1h",
                fvals, closes, klines, n_bars, force=True,
            )
            computed += n

            latest_row = db.execute(text("""
                SELECT icir FROM factor_effectiveness
                WHERE exchange = :ex AND factor_name = :fn AND symbol = :sym
                    AND period = '1h' AND forward_period = '4h'
                ORDER BY calc_date DESC LIMIT 1
            """), {"ex": exchange, "fn": factor_name, "sym": symbol}).fetchone()
            if latest_row:
                icir_values.append(float(latest_row[0]))

        db.commit()

        avg_icir = round(sum(icir_values) / len(icir_values), 4) if icir_values else 0
        return {
            "success": True,
            "factor_name": factor_name, "exchange": exchange,
            "symbols_computed": len(icir_values),
            "total_records": computed,
            "avg_icir_4h": avg_icir,
            "note": f"Computed {factor_name} across {len(icir_values)} symbols. "
                    f"Average 4h ICIR: {avg_icir}",
        }

    # ── internal ──

    def _get_symbols(self, db, exchange):
        try:
            if exchange == "binance":
                from services.binance_symbol_service import get_selected_symbols
            else:
                from services.hyperliquid_symbol_service import get_selected_symbols
            return get_selected_symbols()
        except Exception:
            rows = db.execute(text(
                "SELECT DISTINCT symbol FROM crypto_klines "
                "WHERE exchange = :ex AND period = '1h' LIMIT 50"
            ), {"ex": exchange}).fetchall()
            return [r[0] for r in rows]

    def _compute_symbol(self, db, exchange, symbol, period, force=False) -> int:
        """Compute factor effectiveness for one symbol using sliding window IC."""
        from services.factor_data_provider import ensure_kline_coverage

        klines = ensure_kline_coverage(db, exchange, symbol, period)
        if not klines or len(klines) < 50:
            return 0

        n_bars = len(klines)
        closes = [float(k["close"]) for k in klines]

        tech_keys = list({f["indicator_key"] for f in FACTOR_REGISTRY
                          if f["compute_type"] == "technical"})
        indicators = calculate_indicators(klines, tech_keys)

        factor_series: Dict[str, List[Optional[float]]] = {}
        for fdef in FACTOR_REGISTRY:
            series = self._extract_full_series(
                fdef, indicators, klines, n_bars, db, symbol, exchange)
            if series is not None:
                factor_series[fdef["name"]] = (series, fdef["category"])

        # Count custom factors for accurate progress (builtin + custom = total)
        from database.models import CustomFactor
        try:
            custom_count = db.query(CustomFactor).filter(
                CustomFactor.is_active == True).count()
        except Exception:
            custom_count = 0

        count = 0
        builtin_count = len(factor_series)
        factor_total = builtin_count + custom_count
        for fi, (fname, (fvals, fcat)) in enumerate(factor_series.items()):
            self._progress["current_factor"] = fname
            self._progress["factor_completed"] = fi
            self._progress["factor_total"] = factor_total
            count += self._compute_factor_windowed(
                db, exchange, fname, fcat, symbol, period,
                fvals, closes, klines, n_bars, force=force,
            )

        count += self._compute_custom_effectiveness(
            db, exchange, symbol, period, klines, closes, n_bars,
            force=force, factor_offset=builtin_count, factor_total=factor_total,
        )
        return count

    def _extract_full_series(self, factor_def, indicators, klines, n_bars, db=None, symbol=None, exchange=None):
        """Extract a complete factor value series (vectorized). Returns list or None."""
        ctype = factor_def["compute_type"]

        if ctype == "technical":
            return self._extract_technical_series(factor_def, indicators, klines, n_bars)

        if ctype == "derived":
            return self._extract_derived_series(factor_def, klines, n_bars)

        if ctype == "microstructure" and db and symbol:
            return self._extract_microstructure_series(
                factor_def, klines, db, symbol, exchange or "hyperliquid"
            )

        return None

    def _extract_microstructure_series(self, factor_def, klines, db, symbol, exchange):
        """Extract historical series for microstructure factors aligned to kline timestamps."""
        from sqlalchemy import text

        indicator_key = factor_def.get("indicator_key", "")
        # Build hourly timestamp list from klines (ms)
        ts_list = [int(k["timestamp"]) * 1000 if k["timestamp"] < 1e12 else int(k["timestamp"]) for k in klines]
        hour_ms = 3600 * 1000
        ts_min, ts_max = ts_list[0], ts_list[-1] + hour_ms

        if indicator_key == "OI_DELTA":
            rows = db.execute(text("""
                SELECT timestamp, open_interest FROM market_asset_metrics
                WHERE symbol = :s AND exchange = :e AND open_interest IS NOT NULL
                    AND timestamp >= :tmin AND timestamp < :tmax
                ORDER BY timestamp ASC
            """), {"s": symbol, "e": exchange, "tmin": ts_min, "tmax": ts_max}).fetchall()
            if len(rows) < 10:
                return None
            return self._align_flow_to_klines_delta(rows, ts_list, hour_ms, col_idx=1)

        if indicator_key == "FUNDING":
            rows = db.execute(text("""
                SELECT timestamp, funding_rate FROM market_asset_metrics
                WHERE symbol = :s AND exchange = :e AND funding_rate IS NOT NULL
                    AND timestamp >= :tmin AND timestamp < :tmax
                ORDER BY timestamp ASC
            """), {"s": symbol, "e": exchange, "tmin": ts_min, "tmax": ts_max}).fetchall()
            if len(rows) < 10:
                return None
            return self._align_flow_to_klines_avg(rows, ts_list, hour_ms, col_idx=1)

        if indicator_key in ("CVD", "TAKER"):
            rows = db.execute(text("""
                SELECT timestamp, taker_buy_volume, taker_sell_volume
                FROM market_trades_aggregated
                WHERE symbol = :s AND exchange = :e
                    AND timestamp >= :tmin AND timestamp < :tmax
                ORDER BY timestamp ASC
            """), {"s": symbol, "e": exchange, "tmin": ts_min, "tmax": ts_max}).fetchall()
            if len(rows) < 10:
                return None
            if indicator_key == "CVD":
                return self._align_flow_to_klines_cvd(rows, ts_list, hour_ms)
            else:
                return self._align_flow_to_klines_taker_ratio(rows, ts_list, hour_ms)

        if indicator_key == "DEPTH":
            rows = db.execute(text("""
                SELECT timestamp, bid_depth_5, ask_depth_5
                FROM market_orderbook_snapshots
                WHERE symbol = :s AND exchange = :e
                    AND timestamp >= :tmin AND timestamp < :tmax
                ORDER BY timestamp ASC
            """), {"s": symbol, "e": exchange, "tmin": ts_min, "tmax": ts_max}).fetchall()
            if len(rows) < 10:
                return None
            return self._align_flow_to_klines_depth(rows, ts_list, hour_ms)

        return None

    def _align_flow_to_klines_avg(self, rows, ts_list, hour_ms, col_idx):
        """Average value per kline hour bucket."""
        result = []
        row_idx = 0
        n_rows = len(rows)
        for ts in ts_list:
            vals = []
            while row_idx < n_rows and rows[row_idx][0] < ts:
                row_idx += 1
            j = row_idx
            while j < n_rows and rows[j][0] < ts + hour_ms:
                v = rows[j][col_idx]
                if v is not None:
                    vals.append(float(v))
                j += 1
            result.append(sum(vals) / len(vals) if vals else None)
        return result

    def _align_flow_to_klines_delta(self, rows, ts_list, hour_ms, col_idx):
        """Percentage change of value over each kline hour."""
        result = []
        row_idx = 0
        n_rows = len(rows)
        for ts in ts_list:
            while row_idx < n_rows and rows[row_idx][0] < ts:
                row_idx += 1
            start_val = None
            end_val = None
            j = row_idx
            while j < n_rows and rows[j][0] < ts + hour_ms:
                v = rows[j][col_idx]
                if v is not None:
                    fv = float(v)
                    if start_val is None:
                        start_val = fv
                    end_val = fv
                j += 1
            if start_val and end_val and start_val != 0:
                result.append((end_val - start_val) / start_val * 100)
            else:
                result.append(None)
        return result

    def _align_flow_to_klines_cvd(self, rows, ts_list, hour_ms):
        """Cumulative volume delta per hour: sum(buy - sell)."""
        result = []
        row_idx = 0
        n_rows = len(rows)
        for ts in ts_list:
            cvd = 0.0
            count = 0
            while row_idx < n_rows and rows[row_idx][0] < ts:
                row_idx += 1
            j = row_idx
            while j < n_rows and rows[j][0] < ts + hour_ms:
                buy = float(rows[j][1] or 0)
                sell = float(rows[j][2] or 0)
                cvd += buy - sell
                count += 1
                j += 1
            result.append(cvd if count > 0 else None)
        return result

    def _align_flow_to_klines_taker_ratio(self, rows, ts_list, hour_ms):
        """Taker buy ratio per hour: sum(buy) / sum(buy+sell)."""
        result = []
        row_idx = 0
        n_rows = len(rows)
        for ts in ts_list:
            total_buy = 0.0
            total_sell = 0.0
            count = 0
            while row_idx < n_rows and rows[row_idx][0] < ts:
                row_idx += 1
            j = row_idx
            while j < n_rows and rows[j][0] < ts + hour_ms:
                total_buy += float(rows[j][1] or 0)
                total_sell += float(rows[j][2] or 0)
                count += 1
                j += 1
            total = total_buy + total_sell
            result.append(total_buy / total if total > 0 and count > 0 else None)
        return result

    def _align_flow_to_klines_depth(self, rows, ts_list, hour_ms):
        """Average depth ratio per hour: bid_depth / ask_depth."""
        result = []
        row_idx = 0
        n_rows = len(rows)
        for ts in ts_list:
            ratios = []
            while row_idx < n_rows and rows[row_idx][0] < ts:
                row_idx += 1
            j = row_idx
            while j < n_rows and rows[j][0] < ts + hour_ms:
                bid = float(rows[j][1] or 0)
                ask = float(rows[j][2] or 0)
                if ask > 0:
                    ratios.append(bid / ask)
                j += 1
            result.append(sum(ratios) / len(ratios) if ratios else None)
        return result

    def _extract_technical_series(self, factor_def, indicators, klines, n_bars):
        """Extract full series from technical indicator results."""
        key = factor_def["indicator_key"]
        raw = indicators.get(key)
        if raw is None:
            return None

        extract_key = factor_def.get("extract")
        normalize = factor_def.get("normalize")

        if isinstance(raw, dict):
            if extract_key == "width" and "upper" in raw and "middle" in raw and "lower" in raw:
                u, m, lo = np.array(raw["upper"], dtype=float), np.array(raw["middle"], dtype=float), np.array(raw["lower"], dtype=float)
                with np.errstate(divide='ignore', invalid='ignore'):
                    result = np.where(m != 0, (u - lo) / m, np.nan)
                return [None if np.isnan(v) else float(v) for v in result]

            if extract_key == "percent_b" and "upper" in raw and "lower" in raw:
                u, lo = np.array(raw["upper"], dtype=float), np.array(raw["lower"], dtype=float)
                cl = np.array([float(k["close"]) for k in klines], dtype=float)
                denom = u - lo
                with np.errstate(divide='ignore', invalid='ignore'):
                    result = np.where(denom != 0, (cl - lo) / denom, np.nan)
                return [None if np.isnan(v) else float(v) for v in result]

            if extract_key and extract_key in raw:
                series = raw[extract_key]
                if series and len(series) >= n_bars:
                    return [float(v) if v is not None and not np.isnan(v) else None for v in series[:n_bars]]
                return None

            # Stochastic K/D fallback
            if extract_key == "k":
                for k_key in ("STOCHk", "k", "%K"):
                    if k_key in raw and raw[k_key]:
                        return [float(v) if v is not None and not np.isnan(v) else None for v in raw[k_key][:n_bars]]
            if extract_key == "d":
                for d_key in ("STOCHd", "d", "%D"):
                    if d_key in raw and raw[d_key]:
                        return [float(v) if v is not None and not np.isnan(v) else None for v in raw[d_key][:n_bars]]
            return None

        if isinstance(raw, list) and len(raw) >= n_bars:
            if normalize == "price_deviation":
                cl = [float(k["close"]) for k in klines]
                return [
                    ((cl[i] - raw[i]) / cl[i]) if cl[i] != 0 and raw[i] is not None else None
                    for i in range(n_bars)
                ]
            return [float(v) if v is not None else None for v in raw[:n_bars]]

        return None

    def _extract_derived_series(self, factor_def, klines, n_bars):
        """Extract full series for derived factors (ROC, volume ratio)."""
        derive = factor_def.get("derive_from")
        plen = factor_def.get("period_len", 10)

        if derive == "close":
            closes = np.array([float(k["close"]) for k in klines], dtype=float)
            result = [None] * min(plen, n_bars)
            for i in range(plen, n_bars):
                prev = closes[i - plen]
                result.append((closes[i] - prev) / prev if prev != 0 else None)
            return result

        if derive == "volume_ratio":
            vols = np.array([float(k["volume"]) for k in klines], dtype=float)
            result = [None] * min(plen, n_bars)
            for i in range(plen, n_bars):
                avg = vols[i - plen:i].mean()
                result.append(vols[i] / avg if avg != 0 else None)
            return result

        return None

    def _compute_factor_windowed(self, db, exchange, fname, fcat, symbol, period,
                                  fvals, closes, klines, n_bars, force=False) -> int:
        """Core sliding window IC computation with cross-window ICIR.

        Two-phase approach:
          Phase 1: Slide 720-bar window, compute per-window IC via _calc_ic_fast().
          Phase 2: Compute trailing ICIR across windows (standard quant ICIR definition:
                   mean(IC_series) / std(IC_series) over trailing 30 windows).

        Args:
            force: True = recompute all windows (manual compute, algorithm change).
                   False = skip existing calc_dates (daily cron incremental).
                   ON CONFLICT DO UPDATE ensures force mode overwrites old data.

        Performance: ~0.05ms per _calc_ic_fast call (pure numpy rank correlation)
        vs ~5ms for old _calc_metrics (scipy + pandas rolling). See module docstring.
        """
        WINDOW_BARS = 720   # 30 days of 1h bars
        SLIDE_BARS = 24     # slide by 1 day
        FORWARD_PERIODS = {"1h": 1, "4h": 4, "12h": 12, "24h": 24}
        ICIR_TRAILING = 30  # trailing window count for ICIR computation

        if n_bars < WINDOW_BARS:
            if n_bars < 50:
                return 0
            # Insufficient data for sliding window — single computation, no ICIR
            calc_date = datetime.fromtimestamp(
                klines[-1]["timestamp"], tz=timezone.utc).date()
            count = 0
            ic_by_fp = {}
            for fp_label, fp_hours in FORWARD_PERIODS.items():
                af, ar = self._align_series(fvals, closes, fp_hours, n_bars)
                if len(af) < 10:
                    continue
                m = self._calc_ic_fast(af, ar)
                ic_by_fp[fp_label] = m["ic"]
                dhl = None  # not enough data for decay
                self._upsert(db, exchange, fname, fcat, symbol, period,
                             fp_label, calc_date, n_bars,
                             {"ic_mean": m["ic"], "ic_std": 0.0, "icir": 0.0,
                              "win_rate": m["win_rate"], "sample_count": m["sample_count"],
                              "decay_half_life": dhl})
                count += 1
            return count

        # Load existing data: used for incremental skip AND trailing ICIR base
        existing_by_fp: Dict[str, list] = {fp: [] for fp in FORWARD_PERIODS}
        existing_dates = set()
        if not force:
            rows = db.execute(text("""
                SELECT forward_period, calc_date, ic_mean FROM factor_effectiveness
                WHERE exchange = :ex AND factor_name = :fn
                    AND symbol = :sym AND period = :p
                ORDER BY calc_date
            """), {"ex": exchange, "fn": fname, "sym": symbol, "p": period}).fetchall()
            for r in rows:
                existing_by_fp.setdefault(r[0], []).append((r[1], float(r[2])))
                existing_dates.add(r[1])

        # Phase 1: Compute per-window IC for each forward_period
        # window_data[calc_date][fp_label] = {ic, win_rate, sample_count}
        window_data: Dict[date, Dict[str, dict]] = {}
        for end_idx in range(WINDOW_BARS, n_bars + 1, SLIDE_BARS):
            start_idx = end_idx - WINDOW_BARS
            calc_date = datetime.fromtimestamp(
                klines[end_idx - 1]["timestamp"], tz=timezone.utc).date()

            if not force and calc_date in existing_dates:
                continue

            w_fvals = fvals[start_idx:end_idx]
            w_closes = closes[start_idx:end_idx]
            w_n = end_idx - start_idx

            fp_results = {}
            for fp_label, fp_hours in FORWARD_PERIODS.items():
                af, ar = self._align_series(w_fvals, w_closes, fp_hours, w_n)
                if len(af) < 10:
                    continue
                fp_results[fp_label] = self._calc_ic_fast(af, ar)
            if fp_results:
                window_data[calc_date] = fp_results

        if not window_data:
            return 0

        # Phase 2: Compute trailing ICIR and upsert
        count = 0
        for fp_label in FORWARD_PERIODS:
            # Merge existing + new ICs in chronological order
            existing_ics = existing_by_fp.get(fp_label, [])
            new_entries = sorted(
                [(d, window_data[d][fp_label])
                 for d in window_data if fp_label in window_data[d]],
                key=lambda x: x[0],
            )
            all_ics = [ic for _, ic in existing_ics] + [m["ic"] for _, m in new_entries]
            all_dates = [d for d, _ in existing_ics] + [d for d, _ in new_entries]
            # Sort combined by date
            sorted_pairs = sorted(zip(all_dates, all_ics), key=lambda x: x[0])
            ic_series = [ic for _, ic in sorted_pairs]
            date_to_idx = {d: i for i, (d, _) in enumerate(sorted_pairs)}

            for calc_date, m in new_entries:
                idx = date_to_idx[calc_date]
                start = max(0, idx - ICIR_TRAILING + 1)
                trailing = ic_series[start:idx + 1]

                if len(trailing) >= 3:
                    ic_mean = float(np.mean(trailing))
                    ic_std = float(np.std(trailing))
                    icir = ic_mean / ic_std if ic_std > 1e-8 else 0.0
                else:
                    ic_mean = m["ic"]
                    ic_std = 0.0
                    icir = 0.0

                # Decay half-life from this window's IC across forward periods
                ic_by_fp = {fp: window_data[calc_date][fp]["ic"]
                            for fp in window_data[calc_date]}
                dhl = self._compute_decay_half_life(ic_by_fp, FORWARD_PERIODS)

                self._upsert(db, exchange, fname, fcat, symbol, period,
                             fp_label, calc_date, WINDOW_BARS, {
                                 "ic_mean": round(m["ic"], 6),
                                 "ic_std": round(ic_std, 6),
                                 "icir": round(icir, 4),
                                 "win_rate": round(m["win_rate"], 4),
                                 "sample_count": m["sample_count"],
                                 "decay_half_life": dhl,
                             })
                count += 1

        return count

    def _compute_custom_effectiveness(self, db, exchange, symbol, period,
                                       klines, closes, n_bars, force=False,
                                       factor_offset=0, factor_total=0):
        """Compute IC for active custom factors using sliding window."""
        import pandas as pd
        from database.models import CustomFactor
        from services.factor_expression_engine import factor_expression_engine

        try:
            custom_factors = db.query(CustomFactor).filter(
                CustomFactor.is_active == True).all()
        except Exception:
            return 0

        count = 0
        for ci, cf in enumerate(custom_factors):
            self._progress["current_factor"] = cf.name
            self._progress["factor_completed"] = factor_offset + ci
            self._progress["factor_total"] = factor_total
            try:
                series, err = factor_expression_engine.execute(cf.expression, klines)
                if series is None or len(series) != n_bars:
                    continue
                fvals = [None if pd.isna(v) else float(v) for v in series.tolist()]
                count += self._compute_factor_windowed(
                    db, exchange, cf.name, cf.category or "custom", symbol, period,
                    fvals, closes, klines, n_bars, force=force,
                )
            except Exception as e:
                logger.warning(f"[FactorEffectiveness] custom '{cf.name}' err: {e}")
        return count

    def _align_series(self, fvals, closes, offset, n_bars):
        """Align factor values with forward returns, filtering None."""
        aligned_fv, aligned_rt = [], []
        for i in range(n_bars - offset):
            fv = fvals[i]
            if fv is None or closes[i] == 0:
                continue
            ret = (closes[i + offset] - closes[i]) / closes[i]
            aligned_fv.append(fv)
            aligned_rt.append(ret)
        return aligned_fv, aligned_rt

    def _calc_ic_fast(self, factor_vals, returns):
        """Fast per-window IC computation using pure numpy rank correlation.

        Why this exists (2026-03 optimization):
          The old _calc_metrics() used scipy.spearmanr + pandas rolling IC to compute
          both IC and ICIR within a single window. That approach was designed for
          one-shot full-data mode (called ~700 times total). When we switched to
          sliding window mode, it gets called ~147K times (89 factors × 2 symbols ×
          207 windows × 4 forward_periods), taking ~15 minutes.

          In sliding window mode, ICIR is properly computed ACROSS windows (trailing
          mean/std of per-window ICs) — the standard quantitative finance definition.
          So each window only needs a simple Spearman rank correlation (IC) + win_rate.

          Pure numpy implementation avoids scipy/pandas import overhead and function
          call overhead. Benchmark: ~0.05ms vs ~5ms per call = 100x speedup.
          Total full computation: ~30-60s vs ~15 minutes.

        Returns: {"ic": float, "win_rate": float, "sample_count": int}
        """
        n = len(factor_vals)
        fv = np.array(factor_vals, dtype=float)
        rt = np.array(returns, dtype=float)

        # Spearman rank correlation via numpy argsort (avoids scipy overhead)
        fv_rank = np.argsort(np.argsort(fv)).astype(float)
        rt_rank = np.argsort(np.argsort(rt)).astype(float)
        fv_rank -= fv_rank.mean()
        rt_rank -= rt_rank.mean()
        denom = np.sqrt((fv_rank ** 2).sum() * (rt_rank ** 2).sum())
        ic = float((fv_rank * rt_rank).sum() / denom) if denom > 1e-10 else 0.0

        signs_match = np.sign(fv) == np.sign(rt)
        win_rate = float(signs_match.mean())

        return {
            "ic": round(ic, 6),
            "win_rate": round(win_rate, 4),
            "sample_count": n,
        }

    def _calc_metrics(self, factor_vals, returns):
        """Legacy: Compute IC, ICIR, win_rate within a single data window.

        Kept for backward compatibility but no longer called by sliding window code.
        The sliding window pipeline uses _calc_ic_fast() per window + cross-window
        ICIR computation instead. See _calc_ic_fast() docstring for rationale.
        """
        from scipy.stats import spearmanr
        import pandas as pd

        n = len(factor_vals)
        fv = np.array(factor_vals, dtype=float)
        rt = np.array(returns, dtype=float)

        ic, _ = spearmanr(fv, rt)
        ic = float(ic) if not np.isnan(ic) else 0.0

        # Rolling IC for ICIR using rank-based Pearson (vectorized via pandas)
        # Use non-overlapping windows for large datasets to avoid O(n) scipy calls
        window = min(50, max(20, n // 20))
        ics = []
        if window >= 10 and n >= window * 3:
            fv_rank = pd.Series(fv).rolling(window).rank()
            rt_rank = pd.Series(rt).rolling(window).rank()
            # Sample at window-stride intervals to avoid redundant overlapping windows
            stride = max(1, window // 2)
            for i in range(window - 1, n, stride):
                fr = fv_rank.iloc[i - window + 1:i + 1].values
                rr = rt_rank.iloc[i - window + 1:i + 1].values
                valid = ~(np.isnan(fr) | np.isnan(rr))
                if valid.sum() < 10:
                    continue
                fr_v, rr_v = fr[valid], rr[valid]
                denom = np.std(fr_v) * np.std(rr_v)
                if denom > 1e-10:
                    corr = np.corrcoef(fr_v, rr_v)[0, 1]
                    if not np.isnan(corr):
                        ics.append(corr)

        ic_mean = float(np.mean(ics)) if ics else ic
        ic_std = float(np.std(ics)) if ics else 0.0
        icir = ic_mean / ic_std if ic_std > 1e-8 else 0.0

        signs_match = np.sign(fv) == np.sign(rt)
        win_rate = float(signs_match.mean())

        return {
            "ic_mean": round(ic_mean, 6), "ic_std": round(ic_std, 6),
            "icir": round(icir, 4), "win_rate": round(win_rate, 4),
            "sample_count": n,
        }

    def _compute_decay_half_life(self, ic_by_fp: Dict[str, float],
                                  forward_periods: Dict[str, int]) -> Optional[int]:
        """Fit exponential decay |IC(t)| = a * exp(-lambda * t) across forward periods.

        Returns:
            positive int: half_life in hours (factor prediction decays over time)
            -1: IC strengthens over time (trend/persistent factor, no decay)
            None: insufficient data to determine pattern
        """
        # Collect (hours, |IC|) pairs with valid IC > 0
        points = []
        for fp_label, fp_hours in forward_periods.items():
            if fp_label in ic_by_fp:
                abs_ic = abs(ic_by_fp[fp_label])
                if abs_ic > 1e-8:
                    points.append((fp_hours, abs_ic))

        if len(points) < 3:
            return None

        points.sort(key=lambda p: p[0])

        # Check decay pattern: first point should be >= last point
        if points[-1][1] >= points[0][1]:
            return -1  # IC strengthens over time (trend factor)

        # Log-linear regression: ln(|IC|) = ln(a) - lambda * t
        t_arr = np.array([p[0] for p in points], dtype=float)
        ln_ic = np.log(np.array([p[1] for p in points], dtype=float))

        # Least squares: ln_ic = b0 + b1 * t, where b1 = -lambda
        t_mean = t_arr.mean()
        ln_mean = ln_ic.mean()
        numerator = ((t_arr - t_mean) * (ln_ic - ln_mean)).sum()
        denominator = ((t_arr - t_mean) ** 2).sum()
        if abs(denominator) < 1e-12:
            return -1  # flat IC, treat as persistent

        slope = numerator / denominator  # should be negative for decay
        if slope >= 0:
            return -1  # not decaying, treat as persistent

        lam = -slope
        half_life_hours = np.log(2) / lam
        half_life = int(round(half_life_hours))

        # Sanity: cap at reasonable range (1h ~ 720h=30d)
        if half_life < 1 or half_life > 720:
            return -1

        return half_life

    def _upsert(self, db, exchange, fname, fcat, symbol, period, fp, calc_date, lookback, m):
        db.execute(text("""
            INSERT INTO factor_effectiveness
                (exchange, factor_name, factor_category, symbol, period, forward_period,
                 calc_date, lookback_days, ic_mean, ic_std, icir,
                 win_rate, decay_half_life, sample_count)
            VALUES
                (:ex, :fn, :fc, :sym, :p, :fp, :cd, :lb, :icm, :ics, :icir,
                 :wr, :dhl, :sc)
            ON CONFLICT (exchange, factor_name, symbol, period, forward_period, calc_date)
            DO UPDATE SET
                ic_mean = EXCLUDED.ic_mean, ic_std = EXCLUDED.ic_std,
                icir = EXCLUDED.icir, win_rate = EXCLUDED.win_rate,
                decay_half_life = EXCLUDED.decay_half_life,
                sample_count = EXCLUDED.sample_count
        """), {
            "ex": exchange, "fn": fname, "fc": fcat, "sym": symbol,
            "p": period, "fp": fp, "cd": calc_date, "lb": lookback,
            "icm": m["ic_mean"], "ics": m["ic_std"], "icir": m["icir"],
            "wr": m["win_rate"], "dhl": m.get("decay_half_life"), "sc": m["sample_count"],
        })


# Singleton
factor_effectiveness_service = FactorEffectivenessService()
