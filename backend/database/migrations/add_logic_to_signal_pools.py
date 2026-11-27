#!/usr/bin/env python3
"""
Migration: Add logic column to signal_pools table

Adds the logic column for AND/OR signal combination logic.
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from sqlalchemy import create_engine, text
from database.connection import DATABASE_URL


def upgrade():
    """Add logic column to signal_pools table"""
    engine = create_engine(DATABASE_URL)

    with engine.connect() as conn:
        # Check if column already exists
        result = conn.execute(text("""
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'signal_pools'
            AND column_name = 'logic'
        """))
        if result.fetchone():
            print("Column logic already exists in signal_pools, skipping")
            return

        # Add logic column with default 'AND'
        conn.execute(text("""
            ALTER TABLE signal_pools
            ADD COLUMN logic VARCHAR(10) DEFAULT 'AND'
        """))

        conn.commit()
        print("Migration completed: logic column added to signal_pools")


def rollback():
    """Remove logic column from signal_pools"""
    engine = create_engine(DATABASE_URL)

    with engine.connect() as conn:
        conn.execute(text("""
            ALTER TABLE signal_pools
            DROP COLUMN IF EXISTS logic
        """))
        conn.commit()
        print("Rollback completed: logic column removed from signal_pools")


if __name__ == "__main__":
    upgrade()
