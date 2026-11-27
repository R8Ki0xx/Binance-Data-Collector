"""
Add decision tracking fields to ai_decision_logs table for complete analysis chain.

Fields added:
- prompt_template_id: Link to strategy/prompt template
- signal_trigger_id: Link to signal trigger
- hyperliquid_order_id: Main order ID from Hyperliquid
- tp_order_id: Take profit order ID
- sl_order_id: Stop loss order ID
- realized_pnl: Realized PnL (filled on user refresh)
- pnl_updated_at: When PnL was last updated

Usage:
    cd /home/wwwroot/hyper-alpha-arena-prod/backend
    source .venv/bin/activate
    python database/migrations/add_decision_tracking_fields.py
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


def index_exists(inspector, table: str, index_name: str) -> bool:
    return index_name in {idx["name"] for idx in inspector.get_indexes(table)}


def upgrade() -> None:
    inspector = inspect(engine)
    table = "ai_decision_logs"

    # Define columns to add: (column_name, sql_type, needs_index)
    columns = [
        ("prompt_template_id", "INTEGER", True),
        ("signal_trigger_id", "INTEGER", True),
        ("hyperliquid_order_id", "VARCHAR(100)", True),
        ("tp_order_id", "VARCHAR(100)", False),
        ("sl_order_id", "VARCHAR(100)", False),
        ("realized_pnl", "DECIMAL(18,6)", False),
        ("pnl_updated_at", "TIMESTAMP", False),
    ]

    with engine.connect() as conn:
        for col_name, col_type, needs_index in columns:
            if not column_exists(inspector, table, col_name):
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col_name} {col_type}"))
                print(f"✅ Added {col_name} to {table}")

                if needs_index:
                    index_name = f"ix_{table}_{col_name}"
                    if not index_exists(inspector, table, index_name):
                        conn.execute(text(f"CREATE INDEX {index_name} ON {table} ({col_name})"))
                        print(f"✅ Created index {index_name}")
            else:
                print(f"ℹ️  {col_name} already exists on {table}")

        conn.commit()
        print("✅ Migration completed successfully")


# Alias for direct execution
main = upgrade


if __name__ == "__main__":
    upgrade()
