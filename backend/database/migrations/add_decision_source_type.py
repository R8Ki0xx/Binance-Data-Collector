"""
Add decision_source_type field to ai_decision_logs table.

This field distinguishes between decisions from:
- "prompt_template": AI Trader decisions (using PromptTemplate)
- "program": Program Trader decisions (using TradingProgram)

The prompt_template_id field is reused to store either PromptTemplate.id or TradingProgram.id,
and decision_source_type indicates which table to query for the name.

Old data will have NULL, which should be treated as "prompt_template" for backward compatibility.
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
    table = "ai_decision_logs"
    column = "decision_source_type"

    with engine.connect() as conn:
        if not column_exists(inspector, table, column):
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} VARCHAR(20)"))
            conn.commit()
            print(f"✅ Added {column} to {table}")
        else:
            print(f"⏭️  Column {column} already exists in {table}, skipping")


def downgrade() -> None:
    """Remove the decision_source_type column (for rollback if needed)."""
    inspector = inspect(engine)
    table = "ai_decision_logs"
    column = "decision_source_type"

    with engine.connect() as conn:
        if column_exists(inspector, table, column):
            conn.execute(text(f"ALTER TABLE {table} DROP COLUMN {column}"))
            conn.commit()
            print(f"✅ Removed {column} from {table}")
        else:
            print(f"⏭️  Column {column} does not exist in {table}, skipping")


if __name__ == "__main__":
    upgrade()
