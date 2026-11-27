"""
Finnhub economic calendar adapter.

Fetches upcoming macro events (FOMC, CPI, NFP, GDP, etc.) and converts
them into NewsItem format. Free tier: 60 req/min, no daily cap.
"""
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import List

import requests

from .base import NewsItem, NewsSourceAdapter

logger = logging.getLogger(__name__)

API_BASE = "https://finnhub.io/api/v1/calendar/economic"
REQUEST_TIMEOUT = 15

# High-impact events that matter for crypto markets
HIGH_IMPACT_KEYWORDS = [
    "fomc", "federal funds rate", "interest rate",
    "cpi", "consumer price", "inflation",
    "nonfarm", "nfp", "employment", "unemployment",
    "gdp", "gross domestic",
    "pce", "personal consumption",
    "retail sales",
]


class FinnhubCalendarAdapter(NewsSourceAdapter):
    source_type = "api"

    def fetch(
        self, symbols: List[str], config: dict
    ) -> List[NewsItem]:
        api_key = config.get("api_key", "")
        if not api_key:
            logger.warning("[Finnhub] No api_key configured, skipping")
            return []

        now = datetime.now(timezone.utc)
        from_date = now.strftime("%Y-%m-%d")
        to_date = (now + timedelta(days=7)).strftime("%Y-%m-%d")

        try:
            resp = requests.get(API_BASE, params={
                "from": from_date,
                "to": to_date,
                "token": api_key,
            }, timeout=REQUEST_TIMEOUT)

            if resp.status_code == 429:
                logger.warning("[Finnhub] Rate limited")
                return []
            if resp.status_code != 200:
                logger.warning(
                    "[Finnhub] HTTP %s: %s",
                    resp.status_code, resp.text[:200]
                )
                return []

            data = resp.json()
            events = data.get("economicCalendar", [])
            items = []

            for event in events:
                item = self._parse_event(event)
                if item:
                    items.append(item)

            logger.info(
                "[Finnhub] Fetched %d macro events (%s to %s)",
                len(items), from_date, to_date
            )
            return items

        except Exception as e:
            logger.error("[Finnhub] Fetch error: %s", e)
            return []

    def _parse_event(self, event: dict) -> NewsItem | None:
        event_name = event.get("event", "").strip()
        if not event_name:
            return None

        country = event.get("country", "")
        impact = event.get("impact", "low")

        # Build title with impact and country
        title = f"[{impact.upper()}] {country}: {event_name}"

        # Build summary with actual/estimate/prev values
        parts = []
        actual = event.get("actual")
        estimate = event.get("estimate")
        prev = event.get("prev")
        if actual is not None:
            parts.append(f"Actual: {actual}")
        if estimate is not None:
            parts.append(f"Estimate: {estimate}")
        if prev is not None:
            parts.append(f"Previous: {prev}")
        summary = " | ".join(parts) if parts else ""

        # Parse event time
        published_at = None
        time_str = event.get("time", "")
        date_str = event.get("date", "")
        if date_str:
            try:
                dt_str = f"{date_str}T{time_str}" if time_str else date_str
                published_at = datetime.fromisoformat(
                    dt_str.replace("Z", "+00:00")
                )
            except (ValueError, TypeError):
                pass

        # Macro events tagged as _MACRO (applies to all symbols)
        return NewsItem(
            title=title,
            source_url=f"https://finnhub.io/calendar/economic",
            summary=summary,
            published_at=published_at,
            symbols=["_MACRO"],
            raw_data=json.dumps(event, default=str),
        )
