#!/usr/bin/env python3
"""
Migration: Fix enabled column type from varchar to boolean

Converts enabled/scheduled_enabled columns from varchar to boolean type.
This fixes the type mismatch between ORM models and database schema.

Idempotent: Checks current type before converting, skips if already boolean.
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from sqlalchemy import create_engine, text
from database.connection import DATABASE_URL


def upgrade():
    """Convert varchar enabled columns to boolean type"""
    engine = create_engine(DATABASE_URL)

    # Tables and columns to fix
    tables_columns = [
        ('signal_definitions', 'enabled'),
        ('signal_pools', 'enabled'),
        ('trader_trigger_config', 'scheduled_enabled'),
    ]

    with engine.connect() as conn:
        for table, column in tables_columns:
            try:
                # Check if table exists
                result = conn.execute(text("""
                    SELECT 1 FROM information_schema.tables
                    WHERE table_name = :table AND table_schema = 'public'
                """), {"table": table})

                if not result.fetchone():
                    print(f"Table {table} not found, skipping")
                    continue

                # Check current column type
                result = conn.execute(text("""
                    SELECT data_type FROM information_schema.columns
                    WHERE table_name = :table AND column_name = :column
                """), {"table": table, "column": column})

                row = result.fetchone()
                if not row:
                    print(f"Column {table}.{column} not found, skipping")
                    continue

                current_type = row[0]

                if current_type == 'boolean':
                    print(f"Column {table}.{column} already boolean, skipping")
                    continue

                if current_type in ('character varying', 'text'):
                    print(f"Converting {table}.{column} from {current_type} to boolean...")

                    # Convert type with USING clause to handle string values
                    conn.execute(text(f"""
                        ALTER TABLE {table}
                        ALTER COLUMN {column} TYPE boolean
                        USING (COALESCE({column}, 'true') IN ('true', 't', '1', 'TRUE'))
                    """))

                    # Set default value
                    conn.execute(text(f"""
                        ALTER TABLE {table}
                        ALTER COLUMN {column} SET DEFAULT true
                    """))

                    conn.commit()
                    print(f"Converted {table}.{column} to boolean successfully")
                else:
                    print(f"Column {table}.{column} has unexpected type {current_type}, skipping")

            except Exception as e:
                print(f"Error processing {table}.{column}: {e}")
                continue

    print("Migration fix_enabled_column_type completed")


def rollback():
    """Rollback is not supported for type changes"""
    print("Rollback not supported - boolean to varchar conversion may lose data")


if __name__ == "__main__":
    upgrade()
