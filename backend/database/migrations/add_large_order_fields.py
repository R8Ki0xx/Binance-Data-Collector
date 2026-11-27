"""
Migration: Add large order tracking fields to market_trades_aggregated.

Adds 4 columns for tracking large/whale orders separately from retail flow.
Idempotent: checks if columns exist before adding.
"""
import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from connection import SessionLocal

COLUMNS = [
    ("large_buy_notional", "DECIMAL(24,6) NOT NULL DEFAULT 0"),
    ("large_sell_notional", "DECIMAL(24,6) NOT NULL DEFAULT 0"),
    ("large_buy_count", "INTEGER NOT NULL DEFAULT 0"),
    ("large_sell_count", "INTEGER NOT NULL DEFAULT 0"),
]


def upgrade():
    """Apply the migration (idempotent)."""
    print("Starting migration: add_large_order_fields")

    db = SessionLocal()
    try:
        for col_name, col_type in COLUMNS:
            result = db.execute(text(
                "SELECT EXISTS (SELECT FROM information_schema.columns "
                "WHERE table_name = 'market_trades_aggregated' "
                f"AND column_name = '{col_name}')"
            ))
            if result.scalar():
                print(f"  {col_name} already exists, skipping")
                continue

            db.execute(text(
                f"ALTER TABLE market_trades_aggregated "
                f"ADD COLUMN {col_name} {col_type}"
            ))
            print(f"  Added {col_name}")

        db.commit()
        print("Migration completed: add_large_order_fields")

    except Exception as e:
        db.rollback()
        print(f"Migration failed: {e}")
        raise
    finally:
        db.close()
