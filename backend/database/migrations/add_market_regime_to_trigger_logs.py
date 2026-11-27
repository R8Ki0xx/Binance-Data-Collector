#!/usr/bin/env python3
"""
Migration: Add market_regime column to signal_trigger_logs table

This migration adds a market_regime column to store Market Regime classification
results when signals are triggered.

Idempotent: checks if column exists before adding, skips if already present.

Column format (JSON stored as TEXT):
{
    "regime": "breakout",
    "direction": "long",
    "confidence": 0.85,
    "reason": "Strong CVD with OI expansion"
}
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from sqlalchemy import create_engine, text
from database.connection import DATABASE_URL


def column_exists(conn, table_name: str, column_name: str) -> bool:
    """Check if a column exists in a table"""
    result = conn.execute(text("""
        SELECT column_name FROM information_schema.columns
        WHERE table_name = :table AND column_name = :column
    """), {"table": table_name, "column": column_name})
    return result.fetchone() is not None


def migrate():
    """Add market_regime column to signal_trigger_logs table"""
    engine = create_engine(DATABASE_URL)

    print("Adding market_regime column to signal_trigger_logs...")

    with engine.connect() as conn:
        if column_exists(conn, "signal_trigger_logs", "market_regime"):
            print("  - market_regime column already exists, skipping")
            return

        conn.execute(text("""
            ALTER TABLE signal_trigger_logs
            ADD COLUMN market_regime TEXT
        """))
        conn.commit()
        print("  - market_regime column added successfully")

    print("Migration completed")


def upgrade():
    """Entry point for migration manager"""
    migrate()


if __name__ == "__main__":
    migrate()
