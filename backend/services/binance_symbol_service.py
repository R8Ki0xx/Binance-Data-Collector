"""Binance symbol management utilities.

Handles:
- Fetching tradable symbol metadata from Binance Futures API
- Persisting available symbols + user-selected watchlist in SystemConfig
- Exposing helpers for other services (data collection, trading, etc.)
"""
from __future__ import annotations

import json
import logging
from typing import Dict, List, Optional

import requests
from sqlalchemy.orm import Session

from database.connection import SessionLocal
from database.models import SystemConfig

logger = logging.getLogger(__name__)

BINANCE_AVAILABLE_SYMBOLS_KEY = "binance_available_symbols"
BINANCE_SELECTED_SYMBOLS_KEY = "binance_selected_symbols"
MAX_WATCHLIST_SYMBOLS = 10
SYMBOL_REFRESH_TASK_ID = "binance_symbol_refresh"

DEFAULT_SYMBOLS: List[Dict[str, str]] = [
    {"symbol": "BTC", "name": "Bitcoin"},
]

BINANCE_FUTURES_API = "https://fapi.binance.com/fapi/v1/exchangeInfo"


def _load_config_value(db: Session, key: str) -> Optional[str]:
    config = db.query(SystemConfig).filter(SystemConfig.key == key).first()
    return config.value if config else None


def _save_config_value(db: Session, key: str, value: str) -> None:
    config = db.query(SystemConfig).filter(SystemConfig.key == key).first()
    if not config:
        config = SystemConfig(key=key, value=value)
        db.add(config)
    else:
        config.value = value
    db.commit()


def _parse_symbol_json(value: Optional[str]) -> List[Dict[str, str]]:
    if not value:
        return []
    try:
        parsed = json.loads(value)
        if isinstance(parsed, list):
            result = []
            for entry in parsed:
                if not isinstance(entry, dict):
                    continue
                symbol = str(entry.get("symbol") or "").upper()
                if not symbol:
                    continue
                result.append(
                    {
                        "symbol": symbol,
                        "name": entry.get("name") or symbol,
                        "type": entry.get("type") or "perpetual",
                    }
                )
            return result
    except json.JSONDecodeError:
        logger.warning("Failed to decode stored Binance symbols; falling back to defaults")
    return []


def _serialize_symbols(symbols: List[Dict[str, str]]) -> str:
    sanitized = []
    seen = set()
    for entry in symbols:
        symbol = str(entry.get("symbol") or "").upper()
        if not symbol or symbol in seen:
            continue
        seen.add(symbol)
        sanitized.append(
            {
                "symbol": symbol,
                "name": entry.get("name") or symbol,
                "type": entry.get("type") or "perpetual",
            }
        )
    return json.dumps(sanitized)


def fetch_remote_symbols() -> List[Dict[str, str]]:
    """Fetch tradable symbols from Binance Futures API."""
    try:
        resp = requests.get(BINANCE_FUTURES_API, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        symbols_data = data.get("symbols") or []
    except Exception as err:
        logger.warning("[Binance] Failed to fetch exchange info: %s", err)
        return []

    results: List[Dict[str, str]] = []
    seen = set()

    for entry in symbols_data:
        if not isinstance(entry, dict):
            continue

        # Only include USDT perpetual contracts that are trading
        if entry.get("status") != "TRADING":
            continue
        if entry.get("quoteAsset") != "USDT":
            continue
        if entry.get("contractType") != "PERPETUAL":
            continue

        base_asset = entry.get("baseAsset", "").upper()
        if not base_asset or base_asset in seen:
            continue
        seen.add(base_asset)

        results.append(
            {
                "symbol": base_asset,
                "name": base_asset,
                "type": "perpetual",
            }
        )

    logger.info("[Binance] Fetched %d tradable symbols from Futures API", len(results))
    return results


def refresh_binance_symbols() -> List[Dict[str, str]]:
    """Refresh available symbol list from Binance."""
    remote_symbols = fetch_remote_symbols()
    if not remote_symbols:
        logger.warning("[Binance] No symbols fetched from API; keeping existing list")

    with SessionLocal() as db:
        if remote_symbols:
            _save_config_value(db, BINANCE_AVAILABLE_SYMBOLS_KEY, _serialize_symbols(remote_symbols))
            _ensure_watchlist_valid(db, remote_symbols)
            logger.info("[Binance] Symbol catalog refreshed (%d symbols)", len(remote_symbols))
        else:
            stored = _parse_symbol_json(_load_config_value(db, BINANCE_AVAILABLE_SYMBOLS_KEY))
            if not stored:
                _save_config_value(db, BINANCE_AVAILABLE_SYMBOLS_KEY, _serialize_symbols(DEFAULT_SYMBOLS))
                _ensure_watchlist_valid(db, DEFAULT_SYMBOLS)
    return get_available_symbols()


def _ensure_watchlist_valid(db: Session, available: List[Dict[str, str]]) -> None:
    """Ensure watchlist contains only valid symbols."""
    available_set = {item["symbol"] for item in available}
    raw_value = _load_config_value(db, BINANCE_SELECTED_SYMBOLS_KEY)

    if not raw_value:
        # First time: check if Hyperliquid watchlist exists, copy it
        hl_watchlist = _load_config_value(db, "hyperliquid_selected_symbols")
        if hl_watchlist:
            try:
                hl_symbols = json.loads(hl_watchlist)
                if isinstance(hl_symbols, list) and hl_symbols:
                    # Filter to only include symbols available on Binance
                    valid_symbols = [s for s in hl_symbols if s in available_set][:MAX_WATCHLIST_SYMBOLS]
                    if valid_symbols:
                        _save_config_value(db, BINANCE_SELECTED_SYMBOLS_KEY, json.dumps(valid_symbols))
                        logger.info("[Binance] Initialized watchlist from Hyperliquid: %s", valid_symbols)
                        return
            except (json.JSONDecodeError, TypeError):
                pass

        # Fallback to defaults
        default = [entry["symbol"] for entry in DEFAULT_SYMBOLS if entry["symbol"] in available_set]
        if not default:
            default = [entry["symbol"] for entry in available[:3]]
        _save_config_value(db, BINANCE_SELECTED_SYMBOLS_KEY, json.dumps(default))
        logger.info("[Binance] Initialized watchlist with defaults: %s", default)
        return

    try:
        symbols = json.loads(raw_value)
        if not isinstance(symbols, list):
            raise ValueError("Selection is not a list")
    except Exception:
        logger.warning("[Binance] Invalid watchlist stored; resetting to defaults")
        default = [entry["symbol"] for entry in DEFAULT_SYMBOLS if entry["symbol"] in available_set]
        if not default:
            default = [entry["symbol"] for entry in available[:3]]
        _save_config_value(db, BINANCE_SELECTED_SYMBOLS_KEY, json.dumps(default))
        return

    # Filter out invalid symbols
    filtered = [s for s in symbols if s in available_set]
    if len(filtered) != len(symbols):
        removed = set(symbols) - set(filtered)
        logger.warning("[Binance] Removed invalid symbols from watchlist: %s", removed)
        _save_config_value(db, BINANCE_SELECTED_SYMBOLS_KEY, json.dumps(filtered[:MAX_WATCHLIST_SYMBOLS]))


def get_available_symbols() -> List[Dict[str, str]]:
    """Return cached available symbols."""
    with SessionLocal() as db:
        raw_value = _load_config_value(db, BINANCE_AVAILABLE_SYMBOLS_KEY)
        symbols = _parse_symbol_json(raw_value)
        if not symbols:
            # Return defaults if nothing stored
            return DEFAULT_SYMBOLS.copy()
        return symbols


def get_available_symbols_info() -> Dict:
    """Return available symbols with metadata for API response."""
    symbols = get_available_symbols()
    return {
        "symbols": symbols,
        "count": len(symbols),
    }


def get_selected_symbols() -> List[str]:
    """Return currently selected Binance watchlist symbols."""
    with SessionLocal() as db:
        raw_value = _load_config_value(db, BINANCE_SELECTED_SYMBOLS_KEY)
        if not raw_value:
            # Initialize with defaults or copy from Hyperliquid
            available = get_available_symbols()
            _ensure_watchlist_valid(db, available)
            raw_value = _load_config_value(db, BINANCE_SELECTED_SYMBOLS_KEY)
            if not raw_value:
                default = [entry["symbol"] for entry in DEFAULT_SYMBOLS]
                _save_config_value(db, BINANCE_SELECTED_SYMBOLS_KEY, json.dumps(default))
                return default

        try:
            symbols = json.loads(raw_value)
            if isinstance(symbols, list):
                return symbols
        except json.JSONDecodeError:
            logger.warning("[Binance] Failed to parse watchlist; returning defaults")

        default = [entry["symbol"] for entry in DEFAULT_SYMBOLS]
        _save_config_value(db, BINANCE_SELECTED_SYMBOLS_KEY, json.dumps(default))
        return default


def update_selected_symbols(symbols: List[str]) -> List[str]:
    """Persist new Binance watchlist (validated)."""
    available = get_available_symbols()
    available_set = {item["symbol"] for item in available}

    # Validate and deduplicate
    unique_symbols = []
    seen = set()
    for sym in symbols:
        sym_upper = str(sym).upper()
        if sym_upper in seen:
            continue
        if sym_upper not in available_set:
            logger.warning("[Binance] Symbol '%s' not in available list, skipping", sym_upper)
            continue
        seen.add(sym_upper)
        unique_symbols.append(sym_upper)

    # Enforce max limit
    if len(unique_symbols) > MAX_WATCHLIST_SYMBOLS:
        logger.warning("[Binance] Watchlist exceeds max %d symbols, truncating", MAX_WATCHLIST_SYMBOLS)
        unique_symbols = unique_symbols[:MAX_WATCHLIST_SYMBOLS]

    with SessionLocal() as db:
        _save_config_value(db, BINANCE_SELECTED_SYMBOLS_KEY, json.dumps(unique_symbols))

    logger.info("[Binance] Watchlist updated: %s", ", ".join(unique_symbols) or "none")
    return unique_symbols


def get_symbol_map() -> Dict[str, Dict[str, str]]:
    """Return a map of symbol -> metadata."""
    symbols = get_available_symbols()
    return {item["symbol"]: item for item in symbols}


def schedule_symbol_refresh_task(interval_seconds: int = 7200) -> None:
    """Register periodic symbol refresh job."""
    from services.scheduler import task_scheduler

    def _task():
        try:
            refreshed = refresh_binance_symbols()
            logger.debug("[Binance] Symbol refresh task ran; %d symbols available", len(refreshed))
        except Exception as err:
            logger.warning("[Binance] Symbol refresh failed: %s", err)

    # Remove existing task if present to avoid duplicates
    task_scheduler.remove_task(SYMBOL_REFRESH_TASK_ID)
    task_scheduler.add_interval_task(
        task_func=_task,
        interval_seconds=interval_seconds,
        task_id=SYMBOL_REFRESH_TASK_ID,
    )
    logger.info("[Binance] Symbol refresh task scheduled (interval: %ds)", interval_seconds)
