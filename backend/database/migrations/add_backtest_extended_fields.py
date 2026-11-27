"""
Migration: Add extended fields to backtest_trigger_logs table.

Adds:
- fee: Trading fee for this trigger
- unrealized_pnl: Current unrealized PnL
- realized_pnl: Realized PnL from this trade
- data_queries: JSON record of data queries during execution
- execution_logs: JSON record of log() outputs during execution
"""
import logging
from sqlalchemy import text
from database.connection import engine

logger = logging.getLogger(__name__)


def upgrade():
    """Entry point for migration manager."""
    run_migration(engine)


def run_migration(engine):
    """Add extended fields to backtest_trigger_logs table."""
    with engine.connect() as conn:
        # Define new columns to add
        new_columns = [
            ("fee", "FLOAT"),
            ("unrealized_pnl", "FLOAT"),
            ("realized_pnl", "FLOAT"),
            ("data_queries", "TEXT"),
            ("execution_logs", "TEXT"),
        ]

        for column_name, column_type in new_columns:
            # Check if column exists
            result = conn.execute(text("""
                SELECT EXISTS (
                    SELECT FROM information_schema.columns
                    WHERE table_name = 'backtest_trigger_logs'
                    AND column_name = :column_name
                )
            """), {"column_name": column_name})

            if result.scalar():
                logger.info(f"⏭️  Column {column_name} already exists, skipping")
            else:
                conn.execute(text(f"""
                    ALTER TABLE backtest_trigger_logs
                    ADD COLUMN {column_name} {column_type}
                """))
                logger.info(f"✅ Added column {column_name} to backtest_trigger_logs")

        conn.commit()
