"""
News Source Management API

GET  /api/news/sources          - List all configured news sources
PUT  /api/news/sources          - Update sources config (enable/disable, add/remove)
POST /api/news/sources/test     - Test a new RSS/API source (fetch + parse preview)
GET  /api/news/stats            - Get collection stats (article counts, last fetch times)
"""
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import List, Optional
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from database.connection import get_db
from database.models import SystemConfig, NewsArticle

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/news", tags=["News Intelligence"])

NEWS_SOURCES_CONFIG_KEY = "news_sources"


class NewsSourceConfig(BaseModel):
    type: str = "rss"
    adapter: str = "rss_generic"
    url: str
    enabled: bool = True
    interval_seconds: int = 300
    config: dict = {}


class NewsSourcesUpdateRequest(BaseModel):
    sources: List[NewsSourceConfig]


class TestSourceRequest(BaseModel):
    url: str
    adapter: str = "rss_generic"
    config: dict = {}


class NewsArticleItem(BaseModel):
    id: int
    source_domain: str
    source_url: str
    title: str
    summary: Optional[str] = None
    published_at: Optional[str] = None
    symbols: List[str] = []
    sentiment: Optional[str] = None
    ai_summary: Optional[str] = None
    relevance_score: Optional[float] = None
    image_url: Optional[str] = None


class NewsArticleListResponse(BaseModel):
    items: List[NewsArticleItem]
    total: int


def _parse_article_symbols(value) -> List[str]:
    """Parse symbols stored as JSON text and fall back safely if malformed."""
    if value is None:
        return []

    if isinstance(value, list):
        return [str(v).upper() for v in value if str(v).strip()]

    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return []

        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            parsed = [part.strip() for part in raw.split(",")]

        if isinstance(parsed, list):
            return [str(v).upper() for v in parsed if str(v).strip()]

    return []


def _validate_test_item(item) -> List[str]:
    """Validate a normalized NewsItem against minimum NewsArticle requirements."""
    issues: List[str] = []

    if not (item.title or "").strip():
        issues.append("missing title")

    source_url = (item.source_url or "").strip()
    if not source_url:
        issues.append("missing source_url")
    else:
        parsed = urlparse(source_url)
        if not parsed.scheme or not parsed.netloc:
            issues.append("invalid source_url")

    if not (item.source_domain or "").strip():
        issues.append("missing source_domain")

    return issues


# ---- GET /api/news/sources ----

@router.get("/articles", response_model=NewsArticleListResponse)
def list_news_articles(
    symbols: Optional[str] = None,
    hours: int = 24,
    limit: int = 20,
    db: Session = Depends(get_db),
):
    """List recent normalized news articles for watchlist/news display."""
    hours = max(1, min(hours, 168))
    limit = max(1, min(limit, 50))

    symbol_filter = {
        part.strip().upper()
        for part in (symbols or "").split(",")
        if part.strip()
    }

    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=hours)

    # Pull a slightly larger recent window, then do defensive symbol filtering in Python
    # because article symbols are stored as JSON text.
    rows = db.query(NewsArticle).filter(
        NewsArticle.published_at >= cutoff,
    ).order_by(
        NewsArticle.published_at.desc().nullslast(),
        NewsArticle.id.desc(),
    ).limit(limit * 5).all()

    items: List[NewsArticleItem] = []

    for article in rows:
        article_symbols = _parse_article_symbols(article.symbols)
        if symbol_filter and not (set(article_symbols) & symbol_filter or "_MACRO" in article_symbols):
            continue

        items.append(
            NewsArticleItem(
                id=article.id,
                source_domain=article.source_domain,
                source_url=article.source_url,
                title=article.title,
                summary=article.summary,
                published_at=article.published_at.isoformat() if article.published_at else None,
                symbols=article_symbols,
                sentiment=article.sentiment,
                ai_summary=article.ai_summary,
                relevance_score=article.relevance_score,
                image_url=article.image_url,
            )
        )

        if len(items) >= limit:
            break

    return {
        "items": items,
        "total": len(items),
    }

@router.get("/sources")
def get_news_sources(db: Session = Depends(get_db)):
    """Get all configured news sources."""
    config = db.query(SystemConfig).filter(
        SystemConfig.key == NEWS_SOURCES_CONFIG_KEY
    ).first()

    if not config or not config.value:
        from services.news_collector_service import DEFAULT_NEWS_SOURCES
        return {"sources": DEFAULT_NEWS_SOURCES}

    try:
        sources = json.loads(config.value)
        return {"sources": sources}
    except (json.JSONDecodeError, TypeError):
        return {"sources": []}


# ---- PUT /api/news/sources ----

@router.put("/sources")
def update_news_sources(
    req: NewsSourcesUpdateRequest,
    db: Session = Depends(get_db),
):
    """Update news sources configuration."""
    sources_data = [s.model_dump() for s in req.sources]
    json_str = json.dumps(sources_data)

    config = db.query(SystemConfig).filter(
        SystemConfig.key == NEWS_SOURCES_CONFIG_KEY
    ).first()

    if config:
        config.value = json_str
    else:
        config = SystemConfig(
            key=NEWS_SOURCES_CONFIG_KEY,
            value=json_str,
            description="News source configurations",
        )
        db.add(config)

    db.commit()

    return {
        "success": True,
        "message": f"Saved {len(sources_data)} news sources",
        "sources": sources_data,
    }


# ---- POST /api/news/sources/test ----

@router.post("/sources/test")
def test_news_source(req: TestSourceRequest):
    """
    Test a news source URL: fetch and parse, return sample articles.
    Does NOT save to database.
    """
    from services.news.registry import get_adapter

    adapter = get_adapter(req.adapter)
    if adapter is None:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown adapter: {req.adapter}",
        )

    adapter_config = dict(req.config)
    adapter_config["url"] = req.url

    try:
        items = adapter.fetch([], adapter_config)
    except Exception as e:
        return {
            "success": False,
            "error": f"Fetch failed: {str(e)}",
            "articles": [],
        }

    if not items:
        return {
            "success": False,
            "error": "No articles found or parsed from this source.",
            "articles": [],
        }

    # Return preview of first 5 articles
    preview = []
    valid_count = 0
    invalid_count = 0
    validation_issues = []

    for item in items[:5]:
        issues = _validate_test_item(item)
        if issues:
            invalid_count += 1
            validation_issues.append({
                "source_url": item.source_url,
                "issues": issues,
            })
        else:
            valid_count += 1

        preview.append({
            "title": item.title[:200] if item.title else "",
            "summary": (item.summary or "")[:300],
            "published_at": (
                item.published_at.isoformat() if item.published_at else None
            ),
            "source_domain": item.source_domain,
            "source_url": item.source_url,
            "image_url": item.image_url,
            "validation_issues": issues,
        })

    for item in items[5:]:
        issues = _validate_test_item(item)
        if issues:
            invalid_count += 1
        else:
            valid_count += 1

    return {
        "success": True,
        "total_fetched": len(items),
        "articles": preview,
        "validation": {
            "schema_match": invalid_count == 0,
            "valid_articles": valid_count,
            "invalid_articles": invalid_count,
            "issues": validation_issues[:10],
        },
    }


# ---- GET /api/news/stats ----

@router.get("/stats")
def get_news_stats(db: Session = Depends(get_db)):
    """Get news collection statistics."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    h24_ago = now - timedelta(hours=24)

    # Total counts
    total = db.query(func.count(NewsArticle.id)).scalar() or 0
    classified = db.query(func.count(NewsArticle.id)).filter(
        NewsArticle.classified == True
    ).scalar() or 0
    with_sentiment = db.query(func.count(NewsArticle.id)).filter(
        NewsArticle.sentiment.isnot(None)
    ).scalar() or 0

    # Last 24h counts by domain
    domain_stats = db.query(
        NewsArticle.source_domain,
        func.count(NewsArticle.id),
    ).filter(
        NewsArticle.published_at >= h24_ago,
    ).group_by(
        NewsArticle.source_domain,
    ).all()

    # Last 24h sentiment distribution
    sentiment_stats = db.query(
        NewsArticle.sentiment,
        func.count(NewsArticle.id),
    ).filter(
        NewsArticle.published_at >= h24_ago,
    ).group_by(
        NewsArticle.sentiment,
    ).all()

    # Most recent article time
    latest = db.query(func.max(NewsArticle.published_at)).scalar()

    return {
        "total_articles": total,
        "classified": classified,
        "with_sentiment": with_sentiment,
        "last_24h": {
            "by_domain": {d: c for d, c in domain_stats},
            "by_sentiment": {s or "unknown": c for s, c in sentiment_stats},
            "total": sum(c for _, c in domain_stats),
        },
        "latest_article_at": latest.isoformat() if latest else None,
    }
