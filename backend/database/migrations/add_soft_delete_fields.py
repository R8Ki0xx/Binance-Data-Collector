#!/usr/bin/env python3
"""
Migration: Add soft delete fields (is_deleted, deleted_at) to 7 entity tables.

Tables affected:
- accounts (Account / AI Trader)
- prompt_templates (PromptTemplate) - already has is_deleted as String, add deleted_at only
- account_prompt_bindings (AccountPromptBinding)
- account_program_bindings (AccountProgramBinding)
- trading_programs (TradingProgram)
- signal_pools (SignalPool)
- signal_definitions (SignalDefinition)

Idempotent: checks column existence before adding.
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from sqlalchemy import create_engine, text
from database.connection import DATABASE_URL

# Tables that need both is_deleted (BOOLEAN) and deleted_at (TIMESTAMP)
TABLES_NEED_BOTH = [
    "accounts",
    "account_prompt_bindings",
    "account_program_bindings",
    "trading_programs",
    "signal_pools",
    "signal_definitions",
]

# prompt_templates already has is_deleted (String), only needs deleted_at
TABLES_NEED_DELETED_AT_ONLY = [
    "prompt_templates",
]


def _column_exists(conn, table: str, column: str) -> bool:
    result = conn.execute(text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_name = :table AND column_name = :column"
    ), {"table": table, "column": column})
    return result.fetchone() is not None


def migrate():
    """Add soft delete columns to entity tables."""
    engine = create_engine(DATABASE_URL)
    changes = 0

    with engine.connect() as conn:
        for table in TABLES_NEED_BOTH:
            if not _column_exists(conn, table, "is_deleted"):
                conn.execute(text(
                    f'ALTER TABLE {table} ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT FALSE'
                ))
                changes += 1
                print(f"  Added is_deleted to {table}")

            if not _column_exists(conn, table, "deleted_at"):
                conn.execute(text(
                    f'ALTER TABLE {table} ADD COLUMN deleted_at TIMESTAMP NULL'
                ))
                changes += 1
                print(f"  Added deleted_at to {table}")

        for table in TABLES_NEED_DELETED_AT_ONLY:
            if not _column_exists(conn, table, "deleted_at"):
                conn.execute(text(
                    f'ALTER TABLE {table} ADD COLUMN deleted_at TIMESTAMP NULL'
                ))
                changes += 1
                print(f"  Added deleted_at to {table}")

        if changes:
            conn.commit()
            print(f"add_soft_delete_fields: {changes} columns added")
        else:
            print("add_soft_delete_fields: all columns already exist")


def upgrade():
    """Entry point for migration manager"""
    migrate()


if __name__ == "__main__":
    migrate()
