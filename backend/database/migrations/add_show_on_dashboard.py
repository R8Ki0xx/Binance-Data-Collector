"""
Add show_on_dashboard field to accounts table.

This field controls whether an AI Trader is visible on the Dashboard.
Users can hide traders they no longer want to see in charts/feeds,
while keeping data collection active.

- True (default): Trader visible on Dashboard (charts, feeds, etc.)
- False: Trader hidden from Dashboard views

Usage:
    cd /home/wwwroot/hyper-alpha-arena-prod/backend
    source .venv/bin/activate
    python database/migrations/add_show_on_dashboard.py
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
    table = "accounts"
    column = "show_on_dashboard"

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
    print("Running migration: add_show_on_dashboard")
    upgrade()
    print("Migration completed")
