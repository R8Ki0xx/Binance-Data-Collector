#!/usr/bin/env python3
"""
Add exchange field to AIDecisionLog and ProgramExecutionLog tables.

This migration adds an 'exchange' column to track which exchange the decision
was executed on (hyperliquid or binance).

Backward compatibility:
- NULL values are treated as "hyperliquid" for historical data
- New records should explicitly set the exchange field
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from sqlalchemy import text
from database.connection import engine


def column_exists(conn, table_name: str, column_name: str) -> bool:
    """Check if a column exists in a table."""
    result = conn.execute(text("""
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = :table AND column_name = :column
        )
    """), {"table": table_name, "column": column_name})
    return result.scalar()


def run():
    """Add exchange column to decision log tables."""
    with engine.connect() as conn:
        # Add exchange to ai_decision_logs
        if not column_exists(conn, "ai_decision_logs", "exchange"):
            conn.execute(text("""
                ALTER TABLE ai_decision_logs
                ADD COLUMN exchange VARCHAR(20)
            """))
            conn.commit()
            print("[Migration] Added 'exchange' column to ai_decision_logs")
        else:
            print("[Migration] Column 'exchange' already exists in ai_decision_logs")

        # Add exchange to program_execution_logs
        if not column_exists(conn, "program_execution_logs", "exchange"):
            conn.execute(text("""
                ALTER TABLE program_execution_logs
                ADD COLUMN exchange VARCHAR(20)
            """))
            conn.commit()
            print("[Migration] Added 'exchange' column to program_execution_logs")
        else:
            print("[Migration] Column 'exchange' already exists in program_execution_logs")


if __name__ == "__main__":
    run()
