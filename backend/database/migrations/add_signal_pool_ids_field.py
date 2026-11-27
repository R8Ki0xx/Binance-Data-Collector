#!/usr/bin/env python3
"""
Migration: Add signal_pool_ids to account_strategy_configs and trader_trigger_config

Supports binding multiple signal pools to an AI Trader (OR relationship).
- signal_pool_ids: TEXT column storing JSON array of pool IDs, e.g. "[1, 2, 3]"
- Migrates existing signal_pool_id values to signal_pool_ids as "[id]"
- Old signal_pool_id column is kept for backward compatibility but deprecated
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from sqlalchemy import create_engine, text
from database.connection import DATABASE_URL


def upgrade():
    """Add signal_pool_ids column and migrate existing data"""
    engine = create_engine(DATABASE_URL)

    with engine.connect() as conn:
        # === Table 1: account_strategy_configs ===
        _migrate_table(conn, "account_strategy_configs")

        # === Table 2: trader_trigger_config ===
        _migrate_table(conn, "trader_trigger_config")

        conn.commit()
        print("Migration completed: signal_pool_ids added to both tables")


def _migrate_table(conn, table_name: str):
    """Add signal_pool_ids column to a table and migrate existing data"""

    # Check if column already exists
    result = conn.execute(text("""
        SELECT column_name FROM information_schema.columns
        WHERE table_name = :table_name
        AND column_name = 'signal_pool_ids'
    """), {"table_name": table_name})

    if result.fetchone():
        print(f"Column signal_pool_ids already exists in {table_name}, checking data migration...")
        _migrate_existing_data(conn, table_name)
        return

    # Add signal_pool_ids column (TEXT to store JSON array)
    conn.execute(text(f"""
        ALTER TABLE {table_name}
        ADD COLUMN signal_pool_ids TEXT
    """))
    print(f"Column signal_pool_ids added to {table_name}")

    # Migrate existing signal_pool_id values to signal_pool_ids
    _migrate_existing_data(conn, table_name)


def _migrate_existing_data(conn, table_name: str):
    """Migrate existing signal_pool_id values to signal_pool_ids array format"""

    # Only migrate rows where signal_pool_id is set but signal_pool_ids is not
    result = conn.execute(text(f"""
        UPDATE {table_name}
        SET signal_pool_ids = '[' || signal_pool_id::text || ']'
        WHERE signal_pool_id IS NOT NULL
        AND (signal_pool_ids IS NULL OR signal_pool_ids = '')
    """))

    if result.rowcount > 0:
        print(f"Migrated {result.rowcount} rows in {table_name}: signal_pool_id -> signal_pool_ids")
    else:
        print(f"No data migration needed for {table_name}")


def rollback():
    """Remove signal_pool_ids column (data will be lost)"""
    engine = create_engine(DATABASE_URL)

    with engine.connect() as conn:
        for table_name in ["account_strategy_configs", "trader_trigger_config"]:
            conn.execute(text(f"""
                ALTER TABLE {table_name}
                DROP COLUMN IF EXISTS signal_pool_ids
            """))
            print(f"Rollback: signal_pool_ids removed from {table_name}")

        conn.commit()


if __name__ == "__main__":
    upgrade()
