#!/usr/bin/env python3
"""
Migration: Convert Signal System JSONB columns to TEXT

This migration converts JSONB columns to TEXT for consistency with ORM definitions.
Idempotent: checks column type before converting, skips if already TEXT.

Background:
- ORM models define these fields as Text type
- Old migration script created them as JSONB
- This caused inconsistency between environments
- Code now handles both types with json.loads() parsing
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from sqlalchemy import create_engine, text
from database.connection import DATABASE_URL


def get_column_type(conn, table_name: str, column_name: str) -> str:
    """Get the data type of a column"""
    result = conn.execute(text("""
        SELECT data_type FROM information_schema.columns
        WHERE table_name = :table AND column_name = :column
    """), {"table": table_name, "column": column_name})
    row = result.fetchone()
    return row[0] if row else None


def convert_column_to_text(conn, table_name: str, column_name: str):
    """Convert a JSONB column to TEXT if needed"""
    current_type = get_column_type(conn, table_name, column_name)

    if current_type is None:
        print(f"  - {table_name}.{column_name}: column not found, skipping")
        return

    if current_type == "text":
        print(f"  - {table_name}.{column_name}: already TEXT, skipping")
        return

    if current_type == "jsonb":
        print(f"  - {table_name}.{column_name}: converting JSONB -> TEXT")
        conn.execute(text(f"""
            ALTER TABLE {table_name}
            ALTER COLUMN {column_name} TYPE TEXT
            USING {column_name}::TEXT
        """))
        print(f"  - {table_name}.{column_name}: converted successfully")
    else:
        print(f"  - {table_name}.{column_name}: unexpected type '{current_type}', skipping")


def migrate():
    """Convert JSONB columns to TEXT for signal system tables"""
    engine = create_engine(DATABASE_URL)

    print("Converting signal system JSONB columns to TEXT...")

    with engine.connect() as conn:
        # signal_definitions.trigger_condition
        convert_column_to_text(conn, "signal_definitions", "trigger_condition")

        # signal_pools.signal_ids
        convert_column_to_text(conn, "signal_pools", "signal_ids")

        # signal_pools.symbols
        convert_column_to_text(conn, "signal_pools", "symbols")

        # signal_trigger_logs.trigger_value
        convert_column_to_text(conn, "signal_trigger_logs", "trigger_value")

        conn.commit()

    print("Signal system JSONB to TEXT migration completed")


def upgrade():
    """Entry point for migration manager"""
    migrate()


if __name__ == "__main__":
    migrate()
