"""
Migration: Create news_articles table for market intelligence system.

Idempotent: checks if table exists before creating.
"""
import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from connection import SessionLocal


def upgrade():
    """Apply the migration (idempotent)."""
    print("Starting migration: create_news_articles_table")

    db = SessionLocal()
    try:
        result = db.execute(text(
            "SELECT EXISTS (SELECT FROM information_schema.tables "
            "WHERE table_name = 'news_articles')"
        ))
        if result.scalar():
            print("  Table news_articles already exists, skipping")
        else:
            print("Creating news_articles table...")
            db.execute(text("""
                CREATE TABLE news_articles (
                    id SERIAL PRIMARY KEY,
                    source_domain VARCHAR(255) NOT NULL,
                    source_url TEXT NOT NULL,
                    title VARCHAR(500) NOT NULL,
                    summary TEXT,
                    published_at TIMESTAMP,
                    symbols TEXT,
                    sentiment VARCHAR(20),
                    sentiment_source VARCHAR(20),
                    relevance_score FLOAT,
                    ai_summary TEXT,
                    raw_data TEXT,
                    classified BOOLEAN NOT NULL DEFAULT FALSE,
                    fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    CONSTRAINT news_articles_source_unique
                        UNIQUE (source_domain, source_url)
                )
            """))
            db.execute(text(
                "CREATE INDEX ix_news_articles_source_domain "
                "ON news_articles (source_domain)"
            ))
            db.execute(text(
                "CREATE INDEX ix_news_articles_published_at "
                "ON news_articles (published_at)"
            ))
            print("  Table and indexes created")

        db.commit()
        print("Migration completed: create_news_articles_table")

    except Exception as e:
        db.rollback()
        print(f"Migration failed: {e}")
        raise
    finally:
        db.close()
