#!/usr/bin/env python3
"""
Migration: Create market_sentiment_metrics table for long/short ratio data

This table stores market sentiment data like long/short ratios from exchanges
that provide this information (e.g., Binance). This data is not available
from all exchanges (e.g., Hyperliquid doesn't provide it).

Changes:
1. Create market_sentiment_metrics table
2. Create indexes for efficient querying
3. Create unique constraint
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from connection import SessionLocal


def upgrade():
    """Apply the migration (idempotent - safe to run multiple times)"""
    print("Starting migration: create_market_sentiment_metrics_table")

    db = SessionLocal()
    try:
        # Step 1: Check if table exists
        result = db.execute(text("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_name = 'market_sentiment_metrics'
            )
        """))
        table_exists = result.scalar()

        if table_exists:
            print("  Table market_sentiment_metrics already exists, skipping creation")
        else:
            # Create the table
            print("Creating market_sentiment_metrics table...")
            db.execute(text("""
                CREATE TABLE market_sentiment_metrics (
                    id SERIAL PRIMARY KEY,
                    exchange VARCHAR(20) NOT NULL,
                    symbol VARCHAR(20) NOT NULL,
                    timestamp BIGINT NOT NULL,
                    long_ratio DECIMAL(10, 6),
                    short_ratio DECIMAL(10, 6),
                    long_short_ratio DECIMAL(10, 6),
                    data_type VARCHAR(30) NOT NULL DEFAULT 'top_position',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """))
            print("  Table created")

            # Create indexes
            print("Creating indexes...")
            db.execute(text("""
                CREATE INDEX idx_market_sentiment_exchange
                ON market_sentiment_metrics(exchange)
            """))
            db.execute(text("""
                CREATE INDEX idx_market_sentiment_symbol
                ON market_sentiment_metrics(symbol)
            """))
            db.execute(text("""
                CREATE INDEX idx_market_sentiment_timestamp
                ON market_sentiment_metrics(timestamp)
            """))
            print("  Indexes created")

            # Create unique constraint
            print("Creating unique constraint...")
            db.execute(text("""
                ALTER TABLE market_sentiment_metrics
                ADD CONSTRAINT market_sentiment_metrics_unique_key
                UNIQUE (exchange, symbol, timestamp, data_type)
            """))
            print("  Unique constraint created")

        db.commit()
        print("Migration completed: create_market_sentiment_metrics_table")

    except Exception as e:
        db.rollback()
        print(f"Migration failed: {e}")
        raise
    finally:
        db.close()


def downgrade():
    """Rollback the migration"""
    print("Starting rollback: create_market_sentiment_metrics_table")

    db = SessionLocal()
    try:
        print("Dropping market_sentiment_metrics table...")
        db.execute(text("DROP TABLE IF EXISTS market_sentiment_metrics CASCADE"))
        db.commit()
        print("Rollback completed: create_market_sentiment_metrics_table")

    except Exception as e:
        db.rollback()
        print(f"Rollback failed: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description='Market Sentiment Metrics Migration')
    parser.add_argument('--rollback', action='store_true', help='Rollback the migration')
    args = parser.parse_args()

    if args.rollback:
        downgrade()
    else:
        upgrade()
