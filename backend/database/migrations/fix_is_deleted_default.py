#!/usr/bin/env python3
"""
Migration: Fix is_deleted column DEFAULT value.

Problem: ORM used `default=False` (Python-side) instead of `server_default`.
When create_all() creates tables, columns have no DEFAULT in database.
This causes INSERT without explicit is_deleted to fail with:
  "null value in column 'is_deleted' violates not-null constraint"

This migration adds DEFAULT FALSE to is_deleted columns that are missing it.
Idempotent: checks column_default before altering.
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from sqlalchemy import create_engine, text
from database.connection import DATABASE_URL

TABLES_WITH_IS_DELETED = [
    "accounts",
    "account_prompt_bindings",
    "account_program_bindings",
    "trading_programs",
    "signal_pools",
    "signal_definitions",
]


def _get_column_default(conn, table: str, column: str):
    """Get the default value of a column, returns None if no default."""
    result = conn.execute(text(
        "SELECT column_default FROM information_schema.columns "
        "WHERE table_name = :table AND column_name = :column"
    ), {"table": table, "column": column})
    row = result.fetchone()
    return row[0] if row else None


def _column_exists(conn, table: str, column: str) -> bool:
    """Check if column exists in table."""
    result = conn.execute(text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_name = :table AND column_name = :column"
    ), {"table": table, "column": column})
    return result.fetchone() is not None


def migrate():
    """Add DEFAULT FALSE to is_deleted columns that are missing it."""
    engine = create_engine(DATABASE_URL)
    changes = 0

    with engine.connect() as conn:
        for table in TABLES_WITH_IS_DELETED:
            if not _column_exists(conn, table, "is_deleted"):
                # Column doesn't exist yet, skip (will be added by other migration)
                continue

            current_default = _get_column_default(conn, table, "is_deleted")

            # If no default, add it
            if current_default is None:
                conn.execute(text(
                    f'ALTER TABLE {table} ALTER COLUMN is_deleted SET DEFAULT FALSE'
                ))
                changes += 1
                print(f"  Fixed is_deleted DEFAULT on {table}")

        if changes:
            conn.commit()
            print(f"fix_is_deleted_default: {changes} columns fixed")
        else:
            print("fix_is_deleted_default: all columns already have DEFAULT")


def upgrade():
    """Entry point for migration manager"""
    migrate()


if __name__ == "__main__":
    migrate()
