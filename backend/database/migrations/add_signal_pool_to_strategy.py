#!/usr/bin/env python3
"""
Migration: Add signal_pool_id to account_strategy_configs

Allows AI Traders to bind to a signal pool for signal-based triggering.
- signal_pool_id: Foreign key to signal_pools table (nullable)
- When NULL, AI Trader only uses scheduled triggering
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from sqlalchemy import create_engine, text
from database.connection import DATABASE_URL


def upgrade():
    """Add signal_pool_id column to account_strategy_configs"""
    engine = create_engine(DATABASE_URL)

    with engine.connect() as conn:
        # Check if column already exists
        result = conn.execute(text("""
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'account_strategy_configs'
            AND column_name = 'signal_pool_id'
        """))
        if result.fetchone():
            print("Column signal_pool_id already exists, skipping migration")
            return

        # Add signal_pool_id column
        conn.execute(text("""
            ALTER TABLE account_strategy_configs
            ADD COLUMN signal_pool_id INTEGER REFERENCES signal_pools(id) ON DELETE SET NULL
        """))

        # Create index for faster lookups
        conn.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_account_strategy_configs_signal_pool_id
            ON account_strategy_configs(signal_pool_id)
        """))

        conn.commit()
        print("Migration completed: signal_pool_id added to account_strategy_configs")


def rollback():
    """Remove signal_pool_id column from account_strategy_configs"""
    engine = create_engine(DATABASE_URL)

    with engine.connect() as conn:
        conn.execute(text("""
            DROP INDEX IF EXISTS idx_account_strategy_configs_signal_pool_id
        """))
        conn.execute(text("""
            ALTER TABLE account_strategy_configs
            DROP COLUMN IF EXISTS signal_pool_id
        """))
        conn.commit()
        print("Rollback completed: signal_pool_id removed from account_strategy_configs")


if __name__ == "__main__":
    upgrade()
