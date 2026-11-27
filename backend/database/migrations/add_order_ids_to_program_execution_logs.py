"""
Migration: Add order ID fields to program_execution_logs table.

These fields enable:
1. Linking Program trades to HyperliquidTrade records in Completed Trades
2. Supporting resting orders that later fill (via update-pnl mechanism)
3. Attribution analysis for Program Trader orders

Fields added:
- hyperliquid_order_id: Main order ID from Hyperliquid
- tp_order_id: Take profit order ID
- sl_order_id: Stop loss order ID
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


def index_exists(conn, index_name: str) -> bool:
    result = conn.execute(text("""
        SELECT indexname FROM pg_indexes
        WHERE indexname = :index_name
    """), {"index_name": index_name})
    return result.fetchone() is not None


def upgrade() -> None:
    inspector = inspect(engine)
    table = "program_execution_logs"

    with engine.connect() as conn:
        # Add hyperliquid_order_id if not exists
        if not column_exists(inspector, table, "hyperliquid_order_id"):
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN hyperliquid_order_id VARCHAR(100)"))
            conn.commit()
            print(f"✅ Added hyperliquid_order_id to {table}")
        else:
            print(f"⏭️  Column hyperliquid_order_id already exists in {table}, skipping")

        # Add tp_order_id if not exists
        if not column_exists(inspector, table, "tp_order_id"):
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN tp_order_id VARCHAR(100)"))
            conn.commit()
            print(f"✅ Added tp_order_id to {table}")
        else:
            print(f"⏭️  Column tp_order_id already exists in {table}, skipping")

        # Add sl_order_id if not exists
        if not column_exists(inspector, table, "sl_order_id"):
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN sl_order_id VARCHAR(100)"))
            conn.commit()
            print(f"✅ Added sl_order_id to {table}")
        else:
            print(f"⏭️  Column sl_order_id already exists in {table}, skipping")

        # Create index on hyperliquid_order_id for faster lookups
        index_name = "ix_program_execution_logs_hyperliquid_order_id"
        if not index_exists(conn, index_name):
            conn.execute(text(f"""
                CREATE INDEX {index_name}
                ON {table} (hyperliquid_order_id)
            """))
            conn.commit()
            print(f"✅ Created index {index_name}")
        else:
            print(f"⏭️  Index {index_name} already exists, skipping")


def downgrade() -> None:
    """Remove the order ID columns (for rollback if needed)."""
    inspector = inspect(engine)
    table = "program_execution_logs"

    with engine.connect() as conn:
        for column in ["hyperliquid_order_id", "tp_order_id", "sl_order_id"]:
            if column_exists(inspector, table, column):
                conn.execute(text(f"ALTER TABLE {table} DROP COLUMN {column}"))
                conn.commit()
                print(f"✅ Removed {column} from {table}")
            else:
                print(f"⏭️  Column {column} does not exist in {table}, skipping")


if __name__ == "__main__":
    upgrade()
