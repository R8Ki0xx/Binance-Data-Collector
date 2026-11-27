"""
Migration: Add image_url column to news_articles table.

Stores thumbnail/preview image URL from news sources (RSS media:content,
enclosure, etc.). We only store the URL, not the image itself.

Idempotent: checks if column exists before adding.
"""
import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from connection import SessionLocal


def upgrade():
    """Apply the migration (idempotent)."""
    print("Starting migration: add_news_image_url")

    db = SessionLocal()
    try:
        result = db.execute(text(
            "SELECT EXISTS (SELECT FROM information_schema.columns "
            "WHERE table_name = 'news_articles' "
            "AND column_name = 'image_url')"
        ))
        if result.scalar():
            print("  image_url already exists, skipping")
            return

        db.execute(text(
            "ALTER TABLE news_articles ADD COLUMN image_url TEXT"
        ))
        db.commit()
        print("  Added image_url column to news_articles")
        print("Migration completed: add_news_image_url")

    except Exception as e:
        db.rollback()
        print(f"Migration failed: {e}")
        raise
    finally:
        db.close()
