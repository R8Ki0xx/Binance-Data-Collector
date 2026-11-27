"""
Add scheduled_trigger_enabled field to account_strategy_configs table.

This field allows users to disable scheduled (interval-based) triggers
while keeping signal pool triggers active.

- True (default): Scheduled trigger enabled, AI runs at trigger_interval
- False: Scheduled trigger disabled, AI only runs on signal pool triggers

Usage:
    cd /home/wwwroot/hyper-alpha-arena-prod/backend
    source .venv/bin/activate
    python database/migrations/add_scheduled_trigger_enabled.py
"""
import os
import sys

from sqlalchemy import inspect, text

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECT_ROOT = os.path.dirname(BASE_DIR)
sys.path.insert(0, PROJECT_ROOT)

from database.connection import engine  # noqa: E402


def column_exists(inspector, table: str, column: str) -> bool:
    return column in {col["name"] for col in inspector.get_columns(table)}


def upgrade() -> None:
    inspector = inspect(engine)
    table = "account_strategy_configs"
    column = "scheduled_trigger_enabled"

    with engine.connect() as conn:
        if not column_exists(inspector, table, column):
            # Add column with default TRUE for existing rows
            conn.execute(text(
                f"ALTER TABLE {table} ADD COLUMN {column} BOOLEAN NOT NULL DEFAULT TRUE"
            ))
            conn.commit()
            print(f"✅ Added {column} to {table}")
        else:
            print(f"⏭️ Column {column} already exists in {table}, skipping")


if __name__ == "__main__":
    print("Running migration: add_scheduled_trigger_enabled")
    upgrade()
    print("Migration completed")
