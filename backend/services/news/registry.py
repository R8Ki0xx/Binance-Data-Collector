"""
News source adapter registry.

Maps adapter names (from SystemConfig) to adapter classes.
New adapters only need to be added to ADAPTER_MAP.
"""
from typing import Dict, Type

from .base import NewsSourceAdapter
from .cryptopanic_adapter import CryptoPanicAdapter
from .rss_adapter import RSSAdapter
from .finnhub_adapter import FinnhubCalendarAdapter

# Adapter name -> class mapping
# The "adapter" field in source config selects which class to use
ADAPTER_MAP: Dict[str, Type[NewsSourceAdapter]] = {
    "cryptopanic": CryptoPanicAdapter,
    "rss_generic": RSSAdapter,
    "finnhub_calendar": FinnhubCalendarAdapter,
}


def get_adapter(adapter_name: str) -> NewsSourceAdapter | None:
    """Get an adapter instance by name."""
    cls = ADAPTER_MAP.get(adapter_name)
    if cls is None:
        return None
    return cls()
