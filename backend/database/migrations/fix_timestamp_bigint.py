#!/usr/bin/env python3
"""
Migration: Fix timestamp column type from INTEGER to BIGINT

This migration fixes the timestamp column type in market flow tables.
PostgreSQL INTEGER (32-bit) cannot store millisecond timestamps (13 digits).
BIGINT (64-bit) is required for millisecond timestamps.

Tables affected:
- market_trades_aggregated
- market_orderbook_snapshots
- market_asset_metrics

IDEMPOTENT: Safe to run multiple times. Checks column type before altering.
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from connection import SessionLocal


def upgrade():
    """Apply the migration - alter timestamp columns to BIGINT if needed"""
    print("Starting migration: fix_timestamp_bigint")

    db = SessionLocal()
    try:
        tables = [
            'market_trades_aggregated',
            'market_orderbook_snapshots',
            'market_asset_metrics'
        ]

        for table in tables:
            # Check if table exists
            result = db.execute(text("""
                SELECT EXISTS (
                    SELECT FROM information_schema.tables
                    WHERE table_name = :table_name
                )
            """), {"table_name": table})
            exists = result.scalar()

            if not exists:
                print(f"Table {table} does not exist, skipping...")
                continue

            # Check current column type
            result = db.execute(text("""
                SELECT data_type FROM information_schema.columns
                WHERE table_name = :table_name AND column_name = 'timestamp'
            """), {"table_name": table})
            current_type = result.scalar()

            if current_type is None:
                print(f"Table {table} has no timestamp column, skipping...")
                continue

            if current_type == 'bigint':
                print(f"Table {table}.timestamp is already BIGINT, skipping...")
                continue

            print(f"Altering {table}.timestamp from {current_type} to BIGINT...")

            # Truncate table first (data is corrupted anyway due to overflow)
            db.execute(text(f"TRUNCATE TABLE {table}"))

            # Alter column type
            db.execute(text(f"ALTER TABLE {table} ALTER COLUMN timestamp TYPE BIGINT"))

            print(f"Successfully altered {table}.timestamp to BIGINT")

        db.commit()
        print("Migration fix_timestamp_bigint completed successfully!")

    except Exception as e:
        db.rollback()
        print(f"Migration failed: {e}")
        raise
    finally:
        db.close()


def downgrade():
    """Revert the migration - not supported"""
    print("Downgrade not supported for this migration")


if __name__ == "__main__":
    upgrade()
