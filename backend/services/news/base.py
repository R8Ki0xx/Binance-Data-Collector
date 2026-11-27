"""
News source adapter base class and shared data models.

All news source adapters implement the same interface, returning
standardized NewsItem objects regardless of the upstream format.
"""
import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Optional
from urllib.parse import urlparse

logger = logging.getLogger(__name__)


@dataclass
class NewsItem:
    """Standardized news article from any source."""
    title: str
    source_url: str
    source_domain: str = ""
    summary: str = ""
    published_at: Optional[datetime] = None
    symbols: List[str] = field(default_factory=list)
    sentiment: Optional[str] = None        # bullish/bearish/neutral
    sentiment_source: Optional[str] = None  # api/keyword/ai
    image_url: Optional[str] = None         # Thumbnail/preview image URL
    raw_data: Optional[str] = None

    def __post_init__(self):
        if not self.source_domain and self.source_url:
            self.source_domain = urlparse(self.source_url).netloc


class NewsSourceAdapter:
    """
    Base class for all news source adapters.

    Each adapter knows how to fetch articles from one type of source
    and convert them into standardized NewsItem objects.
    """
    source_type: str = "unknown"  # "api" or "rss"

    def fetch(
        self, symbols: List[str], config: dict
    ) -> List[NewsItem]:
        """
        Fetch latest articles from this source.

        Args:
            symbols: User's watchlist symbols for filtering
            config: Source-specific configuration (API keys, etc.)

        Returns:
            List of standardized NewsItem objects
        """
        raise NotImplementedError
