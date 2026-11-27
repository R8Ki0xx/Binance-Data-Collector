"""
News Prompt Variables (Phase 1E)

Generates prompt template variables from news_articles table:

Per-symbol:
  {BTC_news_sentiment}      -> sentiment stats
  {BTC_news_headlines}      -> headlines with timestamps
  {BTC_news_detail}         -> headlines + summaries

Special categories:
  {macro_news}              -> macro/economic/geopolitical news (tagged _MACRO)
  {macro_news_detail}       -> macro with summaries
  {macro_news_sentiment}    -> macro sentiment stats
  {crypto_news}             -> general crypto industry news (no specific coin)
  {crypto_news_detail}      -> crypto industry with summaries
  {crypto_news_sentiment}   -> crypto industry sentiment stats

All support time window suffixes: _1h, _4h, _12h, _24h (default 24h)
"""
import json
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Set

from database.models import NewsArticle

logger = logging.getLogger(__name__)

DEFAULT_HOURS = 24
MAX_ARTICLES = 500

TIME_WINDOWS = {
    "1h": 1, "4h": 4, "12h": 12, "24h": 24,
}

# Special category prefixes and their DB symbol mapping
SPECIAL_CATEGORIES = {
    "macro_news": ("_MACRO", "Macro"),
    "crypto_news": ("_GENERAL", "Crypto industry"),
}

VALID_TYPES = {"sentiment", "headlines", "detail"}


def parse_news_variables(template_text: str) -> Set[str]:
    """
    Scan prompt template for news variable placeholders.
    Matches:
      {BTC_news_sentiment}, {BTC_news_headlines_4h}, {BTC_news_detail}
      {macro_news}, {macro_news_detail}, {macro_news_sentiment_4h}
      {crypto_news}, {crypto_news_detail_12h}
    """
    if not template_text:
        return set()
    pattern = r'\{(\w+_news(?:_\w+)*)\}'
    matches = set(re.findall(pattern, template_text))
    # Also match bare {macro_news} and {crypto_news}
    for prefix in SPECIAL_CATEGORIES:
        bare = r'\{(' + prefix + r')\}'
        matches.update(re.findall(bare, template_text))
    return matches


def _parse_var_name(var_name: str):
    """
    Parse variable name into (symbol, var_type, hours).

    Per-symbol:
      "BTC_news_sentiment"      -> ("BTC", "sentiment", 24)
      "BTC_news_headlines_4h"   -> ("BTC", "headlines", 4)
      "BTC_news_detail"         -> ("BTC", "detail", 24)

    Special categories:
      "macro_news"              -> ("_MACRO", "headlines", 24)
      "macro_news_detail"       -> ("_MACRO", "detail", 24)
      "macro_news_sentiment_4h" -> ("_MACRO", "sentiment", 4)
      "crypto_news"             -> ("_GENERAL", "headlines", 24)
      "crypto_news_detail_12h"  -> ("_GENERAL", "detail", 12)
    """
    # Check special categories first
    for prefix, (db_symbol, _) in SPECIAL_CATEGORIES.items():
        if var_name == prefix or var_name.startswith(prefix + "_"):
            suffix = var_name[len(prefix):]
            return _parse_category_suffix(suffix, db_symbol)

    # Standard per-symbol: SYMBOL_news_TYPE or SYMBOL_news_TYPE_PERIOD
    parts = var_name.split("_news_")
    if len(parts) != 2:
        return None
    symbol = parts[0].upper()
    rest = parts[1]

    # Check for time suffix at end
    for tw_key, tw_hours in TIME_WINDOWS.items():
        if rest.endswith(f"_{tw_key}"):
            var_type = rest[: -(len(tw_key) + 1)]
            if var_type in VALID_TYPES:
                return (symbol, var_type, tw_hours)

    if rest in VALID_TYPES:
        return (symbol, rest, DEFAULT_HOURS)
    return None


def _parse_category_suffix(suffix: str, db_symbol: str):
    """
    Parse suffix after macro_news or crypto_news prefix.
    "" -> headlines, 24h
    "_detail" -> detail, 24h
    "_sentiment_4h" -> sentiment, 4h
    "_4h" -> headlines, 4h
    """
    if not suffix:
        return (db_symbol, "headlines", DEFAULT_HOURS)

    # Remove leading underscore
    parts = suffix.lstrip("_").split("_")

    var_type = "headlines"
    hours = DEFAULT_HOURS

    for part in parts:
        if part in VALID_TYPES:
            var_type = part
        elif part in TIME_WINDOWS:
            hours = TIME_WINDOWS[part]

    return (db_symbol, var_type, hours)


def _query_articles(db, symbol: str, hours: int, limit: int) -> List[NewsArticle]:
    """Query articles for a symbol within time window."""
    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=hours)

    q = db.query(NewsArticle).filter(
        NewsArticle.published_at >= cutoff,
        NewsArticle.classified == True,
    )

    if symbol == "_MACRO":
        q = q.filter(NewsArticle.symbols.like('%"_MACRO"%'))
    elif symbol == "_GENERAL":
        q = q.filter(
            (NewsArticle.symbols.is_(None)) |
            (NewsArticle.symbols == "[]") |
            (NewsArticle.symbols == "null")
        )
    else:
        q = q.filter(NewsArticle.symbols.like(f'%"{symbol}"%'))

    return q.order_by(NewsArticle.published_at.desc()).limit(limit).all()


def _fmt_time(dt: Optional[datetime]) -> str:
    if not dt:
        return "??-?? ??:??"
    return dt.strftime("%m-%d %H:%M")


def _build_sentiment(articles: List[NewsArticle], label: str, hours: int) -> str:
    if not articles:
        return f"{label} news ({hours}h): No news available."
    counts = {"bullish": 0, "bearish": 0, "neutral": 0}
    for a in articles:
        s = a.sentiment or "neutral"
        counts[s] = counts.get(s, 0) + 1
    total = len(articles)
    dominant = max(counts, key=counts.get)
    return (
        f"{label} news sentiment ({hours}h): "
        f"{counts['bullish']} bullish, {counts['bearish']} bearish, "
        f"{counts['neutral']} neutral (total {total}). "
        f"Dominant: {dominant}."
    )


def _build_headlines(articles: List[NewsArticle], label: str, hours: int) -> str:
    if not articles:
        return f"{label} news ({hours}h): No news available."
    lines = [f"{label} news ({hours}h, {len(articles)} articles):"]
    for a in articles:
        ts = _fmt_time(a.published_at)
        sentiment = a.sentiment or "neutral"
        title = (a.title or "")[:80]
        lines.append(f"[{ts}] [{sentiment}] {title}")
    return "\n".join(lines)


def _build_detail(articles: List[NewsArticle], label: str, hours: int) -> str:
    if not articles:
        return f"{label} news ({hours}h): No news available."
    lines = [f"{label} news ({hours}h, {len(articles)} articles):"]
    for a in articles:
        ts = _fmt_time(a.published_at)
        sentiment = a.sentiment or "neutral"
        title = (a.title or "")[:80]
        lines.append(f"[{ts}] [{sentiment}] {title}")
        summary = a.ai_summary or a.summary or ""
        if summary:
            lines.append(f"  > {summary[:400]}")
    return "\n".join(lines)


BUILDERS = {
    "sentiment": _build_sentiment,
    "headlines": _build_headlines,
    "detail": _build_detail,
}


def build_news_context(template_text: str, db) -> Dict[str, str]:
    """
    Main entry point. Scan template for news variables, query DB, return context dict.
    Called from _build_prompt_context() in ai_decision_service.py.
    """
    var_names = parse_news_variables(template_text)
    if not var_names:
        return {}

    context = {}
    for var_name in var_names:
        parsed = _parse_var_name(var_name)
        if not parsed:
            context[var_name] = "N/A (invalid news variable)"
            continue

        symbol, var_type, hours = parsed
        builder_fn = BUILDERS.get(var_type)
        if not builder_fn:
            context[var_name] = f"N/A (unknown type: {var_type})"
            continue

        try:
            articles = _query_articles(db, symbol, hours, MAX_ARTICLES)
            # Resolve display label
            display = None
            for prefix, (db_sym, label) in SPECIAL_CATEGORIES.items():
                if symbol == db_sym:
                    display = label
                    break
            if not display:
                display = symbol
            context[var_name] = builder_fn(articles, display, hours)
        except Exception as e:
            logger.warning("[NewsVars] Error building %s: %s", var_name, e)
            context[var_name] = f"N/A (error: {e})"

    return context
