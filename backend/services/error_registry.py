"""
Error Registry for Hyper AI diagnostics.

Maps known error patterns to metadata (severity, exchange, impact, suggestion)
so AI can distinguish critical vs noise errors and filter by exchange relevance.
"""

import re
from typing import Optional, Dict, List

# Severity levels
CRITICAL = "CRITICAL"  # Blocks trading entirely
WARNING = "WARNING"    # Degraded functionality
INFO = "INFO"          # Minor / informational
NOISE = "NOISE"        # Can be safely ignored

# Exchange tags
HL = "hyperliquid"
BN = "binance"
ALL = "all"

REGISTRY: List[Dict] = [
    # ===================== CRITICAL (~25) =====================
    # -- Hyperliquid --
    {"pattern": r"Hyperliquid returned invalid price", "exchange": HL, "severity": CRITICAL,
     "affects": "price_feed", "suggestion": "Hyperliquid API may be down. Check status.hyperliquid.xyz."},
    {"pattern": r"Failed to get price from Hyperliquid", "exchange": HL, "severity": CRITICAL,
     "affects": "price_feed", "suggestion": "Cannot fetch Hyperliquid price. Verify network and API status."},
    {"pattern": r"Failed to get ticker data from Hyperliquid", "exchange": HL, "severity": CRITICAL,
     "affects": "price_feed", "suggestion": "Hyperliquid ticker API unreachable."},
    {"pattern": r"Hyperliquid.*connection.*refused|Hyperliquid.*timeout", "exchange": HL, "severity": CRITICAL,
     "affects": "connectivity", "suggestion": "Network issue connecting to Hyperliquid."},
    {"pattern": r"Failed to execute trade.*Hyperliquid|HL trade execution failed", "exchange": HL, "severity": CRITICAL,
     "affects": "trade_execution", "suggestion": "Trade could not be placed on Hyperliquid."},
    {"pattern": r"Insufficient.*balance|INSUFFICIENT_MARGIN|insufficient margin", "exchange": ALL, "severity": CRITICAL,
     "affects": "trade_execution", "suggestion": "Account balance too low to execute trade."},
    {"pattern": r"wallet.*not found|No wallet bound|no.*wallet.*configured", "exchange": ALL, "severity": CRITICAL,
     "affects": "account_config", "suggestion": "No wallet configured for this account."},
    {"pattern": r"API key.*invalid|InvalidApiKey|Invalid API-key", "exchange": ALL, "severity": CRITICAL,
     "affects": "auth", "suggestion": "API credentials are invalid. Re-bind wallet/API key."},
    {"pattern": r"Signature.*invalid|Invalid signature", "exchange": ALL, "severity": CRITICAL,
     "affects": "auth", "suggestion": "API signature verification failed. Check secret key."},

    # -- Binance --
    {"pattern": r"Failed to get price from Binance", "exchange": BN, "severity": CRITICAL,
     "affects": "price_feed", "suggestion": "Cannot fetch Binance price. Check API connectivity."},
    {"pattern": r"Binance returned invalid price", "exchange": BN, "severity": CRITICAL,
     "affects": "price_feed", "suggestion": "Binance API returned zero/invalid price."},
    {"pattern": r"Failed to get ticker data from Binance", "exchange": BN, "severity": CRITICAL,
     "affects": "price_feed", "suggestion": "Binance ticker API unreachable."},
    {"pattern": r"Binance.*connection.*refused|Binance.*timeout|fapi\.binance\.com.*timeout", "exchange": BN, "severity": CRITICAL,
     "affects": "connectivity", "suggestion": "Network issue connecting to Binance Futures API."},
    {"pattern": r"Failed to execute.*Binance|Binance trade execution failed", "exchange": BN, "severity": CRITICAL,
     "affects": "trade_execution", "suggestion": "Trade could not be placed on Binance."},
    {"pattern": r"-2019.*Margin is insufficient", "exchange": BN, "severity": CRITICAL,
     "affects": "trade_execution", "suggestion": "Binance margin insufficient for this order."},
    {"pattern": r"-1021.*Timestamp.*recvWindow|recvWindow", "exchange": BN, "severity": CRITICAL,
     "affects": "connectivity", "suggestion": "Signed request timestamp drifted outside Binance recvWindow. Check client time sync and transient network delay."},

    # -- LLM / AI --
    {"pattern": r"LLM.*call.*failed|Failed to call LLM|AI provider.*error", "exchange": ALL, "severity": CRITICAL,
     "affects": "ai_decision", "suggestion": "LLM API call failed. Check API key and provider status."},
    {"pattern": r"OpenAI.*rate.*limit|anthropic.*rate.*limit|429.*Too Many Requests", "exchange": ALL, "severity": CRITICAL,
     "affects": "ai_decision", "suggestion": "LLM rate limit hit. Wait or upgrade plan."},
    {"pattern": r"context.*length.*exceeded|token.*limit.*exceeded", "exchange": ALL, "severity": CRITICAL,
     "affects": "ai_decision", "suggestion": "Prompt too long for model context window."},

    # -- Database --
    {"pattern": r"database.*connection.*failed|psycopg2.*OperationalError|could not connect to server", "exchange": ALL, "severity": CRITICAL,
     "affects": "database", "suggestion": "Database connection failed. Check PostgreSQL status."},
    {"pattern": r"deadlock detected|Lock wait timeout", "exchange": ALL, "severity": CRITICAL,
     "affects": "database", "suggestion": "Database deadlock. May need to restart affected service."},

    # ===================== WARNING (~15) =====================
    {"pattern": r"Hyperliquid returned empty K-line data", "exchange": HL, "severity": WARNING,
     "affects": "kline_data", "suggestion": "No K-line data from Hyperliquid. Symbol may be delisted or low volume."},
    {"pattern": r"Binance returned empty K-line data", "exchange": BN, "severity": WARNING,
     "affects": "kline_data", "suggestion": "No K-line data from Binance. Check symbol availability."},
    {"pattern": r"Failed to get K-line data from Hyperliquid", "exchange": HL, "severity": WARNING,
     "affects": "kline_data", "suggestion": "K-line fetch failed. AI decisions may use stale data."},
    {"pattern": r"Failed to get K-line data from Binance", "exchange": BN, "severity": WARNING,
     "affects": "kline_data", "suggestion": "K-line fetch failed. AI decisions may use stale data."},
    {"pattern": r"Failed to fetch premium index|Failed to fetch funding", "exchange": BN, "severity": WARNING,
     "affects": "market_data", "suggestion": "Funding rate data unavailable. Display may show 0."},
    {"pattern": r"Failed to fetch sentiment", "exchange": BN, "severity": WARNING,
     "affects": "market_data", "suggestion": "Long/short ratio unavailable."},
    {"pattern": r"Signal pool.*no recent signals|signal detection.*timeout", "exchange": ALL, "severity": WARNING,
     "affects": "signal_system", "suggestion": "Signal pool not generating signals. Check configuration."},
    {"pattern": r"Trader.*enabled but.*not triggering|stuck trader", "exchange": ALL, "severity": WARNING,
     "affects": "ai_trader", "suggestion": "AI Trader enabled but not executing. Check schedule."},
    {"pattern": r"Position.*size.*exceeds|leverage.*too high", "exchange": ALL, "severity": WARNING,
     "affects": "risk", "suggestion": "Position size or leverage may be too aggressive."},
    {"pattern": r"Retry.*attempt|retrying.*after", "exchange": ALL, "severity": WARNING,
     "affects": "connectivity", "suggestion": "Transient failure with retry. Usually self-resolving."},
    {"pattern": r"WebSocket.*disconnected|ws.*connection.*lost", "exchange": ALL, "severity": WARNING,
     "affects": "realtime_data", "suggestion": "WebSocket connection lost. Auto-reconnect should handle this."},
    {"pattern": r"Factor.*calculation.*failed|factor.*engine.*error", "exchange": ALL, "severity": WARNING,
     "affects": "factor_system", "suggestion": "Factor calculation error. Check factor formula."},
    {"pattern": r"LLM response.*parse.*error|Failed to parse AI|JSON.*parse.*error.*LLM", "exchange": ALL, "severity": WARNING,
     "affects": "ai_decision", "suggestion": "LLM returned unparseable response. Will retry with fallback."},

    # ===================== INFO (~10) =====================
    {"pattern": r"Using cached price", "exchange": ALL, "severity": INFO,
     "affects": "price_feed", "suggestion": "Normal: using price cache to reduce API calls."},
    {"pattern": r"Price snapshot", "exchange": ALL, "severity": INFO,
     "affects": "price_feed", "suggestion": "Routine price snapshot logging."},
    {"pattern": r"Strategy triggered|Strategy execution completed", "exchange": ALL, "severity": INFO,
     "affects": "ai_decision", "suggestion": "Normal AI strategy execution event."},
    {"pattern": r"WebSocket.*reconnect|ws.*reconnected", "exchange": ALL, "severity": INFO,
     "affects": "realtime_data", "suggestion": "WebSocket reconnected successfully."},
    {"pattern": r"Data collection.*completed|collection cycle.*done", "exchange": ALL, "severity": INFO,
     "affects": "data_collection", "suggestion": "Routine data collection cycle completed."},
    {"pattern": r"Migration.*completed|schema.*sync.*done", "exchange": ALL, "severity": INFO,
     "affects": "database", "suggestion": "Database migration ran successfully."},
    {"pattern": r"HOLD.*position|Decided to HOLD", "exchange": ALL, "severity": INFO,
     "affects": "ai_decision", "suggestion": "AI decided to hold. No action needed."},
    {"pattern": r"Notification sent|Bot notification", "exchange": ALL, "severity": INFO,
     "affects": "notification", "suggestion": "Notification delivered successfully."},

    # ===================== NOISE (~20) =====================
    {"pattern": r"was missed by \d+:\d+:\d+", "exchange": ALL, "severity": NOISE,
     "affects": "scheduler", "suggestion": "APScheduler missed execution window. Normal under load."},
    {"pattern": r"apscheduler.*maximum.*instances", "exchange": ALL, "severity": NOISE,
     "affects": "scheduler", "suggestion": "Scheduler overlap. Previous job still running."},
    {"pattern": r"Skipping.*already running|job.*already executing", "exchange": ALL, "severity": NOISE,
     "affects": "scheduler", "suggestion": "Duplicate job skipped. Normal behavior."},
    {"pattern": r"SSL.*certificate.*verify|certificate verify failed", "exchange": ALL, "severity": NOISE,
     "affects": "connectivity", "suggestion": "SSL certificate issue. Usually transient."},
    {"pattern": r"Connection.*reset by peer|ConnectionResetError", "exchange": ALL, "severity": NOISE,
     "affects": "connectivity", "suggestion": "Connection reset. Transient network blip."},
    {"pattern": r"Read timed out|ReadTimeoutError", "exchange": ALL, "severity": NOISE,
     "affects": "connectivity", "suggestion": "HTTP read timeout. Transient."},
    {"pattern": r"Too many open files|OSError.*EMFILE", "exchange": ALL, "severity": NOISE,
     "affects": "system", "suggestion": "File descriptor limit. Consider increasing ulimit."},
    {"pattern": r"DeprecationWarning|FutureWarning|PendingDeprecationWarning", "exchange": ALL, "severity": NOISE,
     "affects": "system", "suggestion": "Python deprecation warning. No immediate impact."},
    {"pattern": r"Event loop is closed|RuntimeError.*event loop", "exchange": ALL, "severity": NOISE,
     "affects": "system", "suggestion": "Async event loop cleanup noise. Harmless."},
    {"pattern": r"asyncio.*task.*destroyed|Task was destroyed but it is pending", "exchange": ALL, "severity": NOISE,
     "affects": "system", "suggestion": "Async task cleanup noise. Harmless."},
    {"pattern": r"Cannot schedule new futures after shutdown", "exchange": ALL, "severity": NOISE,
     "affects": "system", "suggestion": "Thread pool shutdown noise during restart."},
    {"pattern": r"Unhandled message.*type|Unknown message format", "exchange": ALL, "severity": NOISE,
     "affects": "websocket", "suggestion": "Unexpected WS message format. Usually harmless."},
    {"pattern": r"ping.*pong|heartbeat", "exchange": ALL, "severity": NOISE,
     "affects": "websocket", "suggestion": "WebSocket keepalive. Normal."},
    {"pattern": r"No data available for|empty response from", "exchange": ALL, "severity": NOISE,
     "affects": "data_collection", "suggestion": "No data for query. May be off-hours or new symbol."},
    {"pattern": r"UserWarning|ResourceWarning", "exchange": ALL, "severity": NOISE,
     "affects": "system", "suggestion": "Python runtime warning. No impact on functionality."},
    # Context compression errors
    {"pattern": r"Compression API error", "exchange": ALL, "severity": WARNING,
     "affects": "ai_assistant", "suggestion": "Context compression API call failed. Check if the API relay supports long-output requests. Conversation will continue with truncated history."},
    {"pattern": r"Compression exception", "exchange": ALL, "severity": WARNING,
     "affects": "ai_assistant", "suggestion": "Context compression threw an exception. Conversation will continue with truncated history."},
    {"pattern": r"Unknown model.*for context window", "exchange": ALL, "severity": INFO,
     "affects": "ai_assistant", "suggestion": "Model not in known context window list, using 128K fallback. Consider adding the model to MODEL_CONTEXT_WINDOWS."},
]

# Pre-compile patterns for performance
_COMPILED_REGISTRY = []
for entry in REGISTRY:
    _COMPILED_REGISTRY.append({
        **entry,
        "_compiled": re.compile(entry["pattern"], re.IGNORECASE),
    })


def classify_error(message: str) -> Optional[Dict]:
    """Match a log message against the registry. Returns metadata or None."""
    for entry in _COMPILED_REGISTRY:
        if entry["_compiled"].search(message):
            return {
                "severity": entry["severity"],
                "exchange": entry["exchange"],
                "affects": entry["affects"],
                "suggestion": entry["suggestion"],
            }
    return None


def enrich_logs(logs: List[Dict], user_exchange: str = None) -> List[Dict]:
    """
    Enrich log entries with registry metadata.
    Optionally filter to only show logs relevant to user's exchange.
    """
    enriched = []
    for log in logs:
        msg = log.get("message", "")
        match = classify_error(msg)
        if match:
            log["registry"] = match
            # Filter by exchange if specified
            if user_exchange:
                ex = match["exchange"]
                if ex != ALL and ex != user_exchange:
                    log["registry"]["relevance"] = "other_exchange"
        else:
            log["registry"] = {"severity": "UNKNOWN", "exchange": ALL,
                               "affects": "unknown", "suggestion": ""}
        enriched.append(log)
    return enriched


def get_severity_summary(logs: List[Dict]) -> Dict:
    """Summarize enriched logs by severity level."""
    summary = {CRITICAL: 0, WARNING: 0, INFO: 0, NOISE: 0, "UNKNOWN": 0}
    for log in logs:
        reg = log.get("registry", {})
        sev = reg.get("severity", "UNKNOWN")
        summary[sev] = summary.get(sev, 0) + 1
    return summary
