"""
CryptoPanic API news source adapter.

Fetches crypto news with built-in symbol filtering and community
sentiment tags (bullish/bearish). Free tier: ~50-200 req/hr.
"""
import json
import logging
from datetime import datetime, timezone
from typing import List

import requests

from .base import NewsItem, NewsSourceAdapter

logger = logging.getLogger(__name__)

API_BASE = "https://cryptopanic.com/api/free/v2/posts/"
REQUEST_TIMEOUT = 15


class CryptoPanicAdapter(NewsSourceAdapter):
    source_type = "api"

    def fetch(
        self, symbols: List[str], config: dict
    ) -> List[NewsItem]:
        auth_token = config.get("auth_token", "")
        if not auth_token:
            logger.warning("[CryptoPanic] No auth_token configured, skipping")
            return []

        params = {
            "auth_token": auth_token,
            "public": "true",
        }
        # Filter by symbols if provided
        if symbols:
            params["currencies"] = ",".join(symbols)

        try:
            resp = requests.get(
                API_BASE, params=params, timeout=REQUEST_TIMEOUT
            )
            if resp.status_code == 429:
                logger.warning("[CryptoPanic] Rate limited, will retry later")
                return []
            if resp.status_code != 200:
                logger.warning(
                    "[CryptoPanic] HTTP %s: %s",
                    resp.status_code, resp.text[:200]
                )
                return []

            data = resp.json()
            results = data.get("results", [])
            items = []

            for post in results:
                item = self._parse_post(post)
                if item:
                    items.append(item)

            logger.info("[CryptoPanic] Fetched %d articles", len(items))
            return items

        except Exception as e:
            logger.error("[CryptoPanic] Fetch error: %s", e)
            return []

    def _parse_post(self, post: dict) -> NewsItem | None:
        title = post.get("title", "").strip()
        if not title:
            return None

        url = post.get("url") or post.get("original_url", "")
        if not url:
            return None

        # Parse publish time
        published_at = None
        pub_str = post.get("published_at", "")
        if pub_str:
            try:
                published_at = datetime.fromisoformat(
                    pub_str.replace("Z", "+00:00")
                )
            except (ValueError, TypeError):
                pass

        # Extract symbols from currencies field
        symbols = []
        for currency in post.get("currencies", []):
            code = currency.get("code", "")
            if code:
                symbols.append(code.upper())

        # Extract sentiment from votes
        sentiment = None
        sentiment_source = None
        votes = post.get("votes", {})
        if votes:
            positive = votes.get("positive", 0) + votes.get("liked", 0)
            negative = votes.get("negative", 0) + votes.get("disliked", 0)
            if positive > negative and positive >= 2:
                sentiment = "bullish"
                sentiment_source = "api"
            elif negative > positive and negative >= 2:
                sentiment = "bearish"
                sentiment_source = "api"

        # Extract image URL from metadata if available
        image_url = None
        metadata = post.get("metadata", {})
        if isinstance(metadata, dict):
            image_url = metadata.get("image") or metadata.get("thumbnail") or None

        return NewsItem(
            title=title,
            source_url=url,
            summary="",
            published_at=published_at,
            symbols=symbols,
            sentiment=sentiment,
            sentiment_source=sentiment_source,
            image_url=image_url,
            raw_data=json.dumps(post, default=str),
        )
