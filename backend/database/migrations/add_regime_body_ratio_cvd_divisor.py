#!/usr/bin/env python3
"""
Migration: Add body_ratio and cvd_divisor fields to MarketRegimeConfig

New fields:
- breakout_body_ratio: Minimum body/range ratio for Breakout (default 0.4)
- continuation_cvd_divisor: Divisor for cvd_weak calculation (default 3.0)

These were previously hardcoded in market_regime_service.py
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from sqlalchemy import create_engine, text
from database.connection import DATABASE_URL


def column_exists(conn, table_name: str, column_name: str) -> bool:
    """Check if a column exists in a table"""
    result = conn.execute(text("""
        SELECT EXISTS (
            SELECT FROM information_schema.columns
            WHERE table_name = :table AND column_name = :column
        )
    """), {"table": table_name, "column": column_name})
    return result.scalar()


def migrate():
    """Add breakout_body_ratio and continuation_cvd_divisor columns"""
    engine = create_engine(DATABASE_URL)

    with engine.connect() as conn:
        # Add breakout_body_ratio column
        if not column_exists(conn, "market_regime_configs", "breakout_body_ratio"):
            conn.execute(text("""
                ALTER TABLE market_regime_configs
                ADD COLUMN breakout_body_ratio FLOAT DEFAULT 0.4
            """))
            print("Added breakout_body_ratio column")
        else:
            print("breakout_body_ratio column already exists, skipping")

        # Add continuation_cvd_divisor column
        if not column_exists(conn, "market_regime_configs", "continuation_cvd_divisor"):
            conn.execute(text("""
                ALTER TABLE market_regime_configs
                ADD COLUMN continuation_cvd_divisor FLOAT DEFAULT 3.0
            """))
            print("Added continuation_cvd_divisor column")
        else:
            print("continuation_cvd_divisor column already exists, skipping")

        conn.commit()
        print("Migration completed: add_regime_body_ratio_cvd_divisor")


def upgrade():
    """Entry point for migration manager"""
    migrate()


if __name__ == "__main__":
    migrate()
