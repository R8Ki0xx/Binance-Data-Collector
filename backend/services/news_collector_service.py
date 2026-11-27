"""
News Collector Service

Periodically fetches articles from all enabled news sources, deduplicates
against existing records, runs keyword-based symbol classification, and
persists to the news_articles table.

Architecture:
- Uses TaskScheduler for periodic execution (same as other collectors)
- Each source has its own fetch interval (configurable)
- Dedup by (source_domain, source_url) unique constraint
- Stage 1 keyword classification runs inline on insert
- Stage 2 AI classification is handled separately (Phase 1D)
"""
import json
import logging
import threading
import time
from datetime import datetime, timezone
from typing import Dict, List, Optional
from urllib.parse import urlparse

from database.connection import SessionLocal
from database.models import SystemConfig, NewsArticle
from .news.base import NewsItem
from .news.registry import get_adapter

logger = logging.getLogger(__name__)

# Default source configuration (used if no config in SystemConfig)
DEFAULT_NEWS_SOURCES = [
    {
        "type": "rss",
        "adapter": "rss_generic",
        "url": "https://www.coindesk.com/arc/outboundfeeds/rss/",
        "enabled": True,
        "interval_seconds": 300,
        "config": {},
    },
    {
        "type": "rss",
        "adapter": "rss_generic",
        "url": "https://cointelegraph.com/rss",
        "enabled": True,
        "interval_seconds": 300,
        "config": {},
    },
    {
        "type": "rss",
        "adapter": "rss_generic",
        "url": "https://decrypt.co/feed",
        "enabled": True,
        "interval_seconds": 300,
        "config": {},
    },
    {
        "type": "rss",
        "adapter": "rss_generic",
        "url": "https://crypto.news/feed",
        "enabled": True,
        "interval_seconds": 300,
        "config": {},
    },
    {
        "type": "rss",
        "adapter": "rss_generic",
        "url": "https://news.bitcoin.com/feed",
        "enabled": True,
        "interval_seconds": 300,
        "config": {},
    },
    {
        "type": "rss",
        "adapter": "rss_generic",
        "url": "https://feeds.bbci.co.uk/news/business/rss.xml",
        "enabled": True,
        "interval_seconds": 300,
        "config": {},
    },
    {
        "type": "rss",
        "adapter": "rss_generic",
        "url": "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml",
        "enabled": True,
        "interval_seconds": 300,
        "config": {},
    },
    {
        "type": "rss",
        "adapter": "rss_generic",
        "url": "https://www.cnbc.com/id/100003114/device/rss/rss.html",
        "enabled": True,
        "interval_seconds": 300,
        "config": {},
    },
    {
        "type": "rss",
        "adapter": "rss_generic",
        "url": "https://feeds.feedburner.com/TheHackersNews",
        "enabled": True,
        "interval_seconds": 300,
        "config": {},
    },
    {
        "type": "rss",
        "adapter": "rss_generic",
        "url": "https://www.wired.com/feed/tag/ai/latest/rss",
        "enabled": True,
        "interval_seconds": 300,
        "config": {},
    },
]

NEWS_SOURCES_CONFIG_KEY = "news_sources"
NEWS_SYMBOL_KEYWORDS_KEY = "news_symbol_keywords"
NEWS_COLLECTOR_ENABLED_KEY = "news_collector_enabled"

# Default symbol-keyword mapping for Stage 1 classification
DEFAULT_SYMBOL_KEYWORDS = {
    "BTC": ["bitcoin", "btc", "satoshi", "halving", "lightning network"],
    "ETH": ["ethereum", "eth", "vitalik", "erc-20", "erc20", "layer 2"],
    "SOL": ["solana", "sol"],
    "BNB": ["binance coin", "bnb"],
    "XRP": ["ripple", "xrp"],
    "DOGE": ["dogecoin", "doge"],
    "ADA": ["cardano", "ada"],
    "AVAX": ["avalanche", "avax"],
    "DOT": ["polkadot", "dot"],
    "LINK": ["chainlink", "link"],
    "MATIC": ["polygon", "matic"],
    "ARB": ["arbitrum", "arb"],
    "OP": ["optimism"],
    "_MACRO": [
        "fomc", "federal reserve", "fed rate", "interest rate",
        "cpi", "consumer price", "inflation",
        "nonfarm", "nfp", "employment", "unemployment", "jobless",
        "gdp", "gross domestic", "recession",
        "pce", "personal consumption",
        "retail sales", "treasury", "bond yield",
        "tariff", "trade war", "sanctions",
        "geopolitical", "oil price", "crude oil",
        "dollar index", "dxy",
        "s&p 500", "nasdaq", "dow jones",
    ],
}


def _get_config_json(db, key: str, default=None):
    """Read a JSON config value from SystemConfig."""
    config = db.query(SystemConfig).filter(SystemConfig.key == key).first()
    if config and config.value:
        try:
            return json.loads(config.value)
        except (json.JSONDecodeError, TypeError):
            pass
    return default


def _save_config_json(db, key: str, value, description: str = ""):
    """Save a JSON config value to SystemConfig."""
    config = db.query(SystemConfig).filter(SystemConfig.key == key).first()
    json_str = json.dumps(value, ensure_ascii=False)
    if config:
        config.value = json_str
    else:
        config = SystemConfig(key=key, value=json_str, description=description)
        db.add(config)
    db.commit()


def classify_by_keywords(
    title: str, summary: str, keyword_map: Dict[str, List[str]]
) -> List[str]:
    """
    Stage 1 classification: match article text against symbol keywords.
    Returns list of matched symbol codes (e.g. ["BTC", "_MACRO"]).
    """
    text = f"{title} {summary}".lower()
    matched = []
    for symbol, keywords in keyword_map.items():
        for kw in keywords:
            if kw.lower() in text:
                matched.append(symbol)
                break
    return matched


class NewsCollectorService:
    """
    Singleton service that periodically fetches news from all enabled
    sources, deduplicates, classifies by keywords, and stores in DB.
    """
    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._initialized = True
        self.running = False
        self._last_fetch_time: Dict[str, float] = {}
        logger.info("NewsCollectorService initialized")

    def start(self):
        """Start the news collector (called from startup.py)."""
        if self.running:
            logger.warning("NewsCollectorService already running")
            return
        self.running = True
        # Initialize default config if not present
        self._ensure_default_config()
        logger.info("NewsCollectorService started")

    def stop(self):
        """Stop the news collector."""
        self.running = False
        logger.info("NewsCollectorService stopped")

    def _ensure_default_config(self):
        """Write default source/keyword config if not yet in DB."""
        try:
            db = SessionLocal()
            try:
                sources = _get_config_json(db, NEWS_SOURCES_CONFIG_KEY)
                if sources is None:
                    _save_config_json(
                        db, NEWS_SOURCES_CONFIG_KEY,
                        DEFAULT_NEWS_SOURCES,
                        "News source configurations"
                    )
                    logger.info("Initialized default news sources config")

                keywords = _get_config_json(db, NEWS_SYMBOL_KEYWORDS_KEY)
                if keywords is None:
                    _save_config_json(
                        db, NEWS_SYMBOL_KEYWORDS_KEY,
                        DEFAULT_SYMBOL_KEYWORDS,
                        "Symbol keyword mapping for news classification"
                    )
                    logger.info("Initialized default symbol keywords config")
            finally:
                db.close()
        except Exception as e:
            logger.error("Failed to initialize news config: %s", e)

    def collect_all(self):
        """
        Main entry point called by TaskScheduler.
        Iterates all enabled sources, respects per-source intervals,
        fetches new articles, and stores them.
        """
        if not self.running:
            return

        try:
            db = SessionLocal()
            try:
                sources = _get_config_json(
                    db, NEWS_SOURCES_CONFIG_KEY, DEFAULT_NEWS_SOURCES
                )
                keyword_map = _get_config_json(
                    db, NEWS_SYMBOL_KEYWORDS_KEY, DEFAULT_SYMBOL_KEYWORDS
                )
                # Get watchlist symbols for API sources that support filtering
                watchlist = self._get_watchlist_symbols(db)
            finally:
                db.close()

            now = time.time()
            for source in sources:
                if not source.get("enabled", True):
                    continue

                source_url = source.get("url", "")
                interval = source.get("interval_seconds", 300)
                last = self._last_fetch_time.get(source_url, 0)

                if now - last < interval:
                    continue

                self._last_fetch_time[source_url] = now
                try:
                    self._fetch_and_store(
                        source, watchlist, keyword_map
                    )
                except Exception as e:
                    logger.error(
                        "[NewsCollector] Error processing %s: %s",
                        source_url, e
                    )

        except Exception as e:
            logger.error("[NewsCollector] collect_all error: %s", e)

    def _get_watchlist_symbols(self, db) -> List[str]:
        """Get combined watchlist from both exchanges."""
        symbols = set()
        for key in [
            "hyperliquid_selected_symbols",
            "binance_selected_symbols",
        ]:
            config = db.query(SystemConfig).filter(
                SystemConfig.key == key
            ).first()
            if config and config.value:
                try:
                    data = json.loads(config.value)
                    for item in data:
                        if isinstance(item, dict):
                            symbols.add(item.get("symbol", ""))
                        elif isinstance(item, str):
                            symbols.add(item)
                except (json.JSONDecodeError, TypeError):
                    pass
        symbols.discard("")
        return list(symbols) if symbols else ["BTC"]

    def _fetch_and_store(
        self,
        source: dict,
        watchlist: List[str],
        keyword_map: Dict[str, List[str]],
    ):
        """Fetch from one source, dedup, classify, store."""
        adapter_name = source.get("adapter", "")
        adapter = get_adapter(adapter_name)
        if adapter is None:
            logger.warning(
                "[NewsCollector] Unknown adapter: %s", adapter_name
            )
            return

        # Build config for adapter (merge source-level config)
        adapter_config = dict(source.get("config", {}))
        adapter_config["url"] = source.get("url", "")

        # Fetch articles
        items = adapter.fetch(watchlist, adapter_config)
        if not items:
            return

        # Dedup repeated entries within the same feed payload before DB writes.
        # Some feeds (e.g. BBC Business) can return duplicate items in a single
        # response, and SessionLocal uses autoflush=False, so pending inserts are
        # not visible to the per-row DB existence check until commit time.
        deduped_items = []
        seen_keys = set()
        for item in items:
            item_key = (item.source_domain, item.source_url)
            if item_key in seen_keys:
                continue
            seen_keys.add(item_key)
            deduped_items.append(item)

        # Store to database with dedup
        db = SessionLocal()
        try:
            new_count = 0
            for item in deduped_items:
                if self._store_article(db, item, keyword_map):
                    new_count += 1
            db.commit()

            source_url = source.get("url", "")
            if new_count > 0:
                logger.info(
                    "[NewsCollector] %s: %d new / %d total fetched",
                    source_url, new_count, len(deduped_items)
                )
        except Exception as e:
            db.rollback()
            logger.error("[NewsCollector] DB error: %s", e)
        finally:
            db.close()

    def _store_article(
        self,
        db,
        item: NewsItem,
        keyword_map: Dict[str, List[str]],
    ) -> bool:
        """
        Store a single article. Returns True if new, False if duplicate.
        Runs Stage 1 keyword classification inline.
        """
        # Dedup check
        domain = item.source_domain
        existing = db.query(NewsArticle.id).filter(
            NewsArticle.source_domain == domain,
            NewsArticle.source_url == item.source_url,
        ).first()
        if existing:
            return False

        # Stage 1: keyword classification (if no symbols from API)
        symbols = item.symbols or []
        sentiment = item.sentiment
        sentiment_source = item.sentiment_source

        if not symbols:
            symbols = classify_by_keywords(
                item.title, item.summary, keyword_map
            )
            if not sentiment_source:
                sentiment_source = "keyword" if symbols else None

        # Determine if AI classification is needed
        needs_ai = not symbols or sentiment is None
        classified = not needs_ai

        # Prefer original publish time, fallback to current time
        pub_time = item.published_at
        if pub_time is None:
            pub_time = datetime.utcnow()

        article = NewsArticle(
            source_domain=domain,
            source_url=item.source_url,
            title=item.title[:500],
            summary=(item.summary or "")[:2000],
            published_at=pub_time,
            symbols=json.dumps(symbols) if symbols else None,
            sentiment=sentiment,
            sentiment_source=sentiment_source,
            image_url=item.image_url,
            raw_data=item.raw_data,
            classified=classified,
        )
        db.add(article)
        return True


# Singleton instance
news_collector_service = NewsCollectorService()
