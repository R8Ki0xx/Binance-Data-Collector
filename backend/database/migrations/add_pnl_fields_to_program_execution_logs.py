"""
Migration: Add environment, realized_pnl, pnl_updated_at fields to program_execution_logs table.

These fields enable:
1. environment: Filter program executions by testnet/mainnet (like AIDecisionLog)
2. realized_pnl: Store PnL data for attribution analysis
3. pnl_updated_at: Track when PnL was last synced

This migration is idempotent - safe to run multiple times.
"""

import logging
from sqlalchemy import text
from database.connection import SessionLocal

logger = logging.getLogger(__name__)


def run_migration():
    """Add environment, realized_pnl, pnl_updated_at columns to program_execution_logs."""
    db = SessionLocal()
    try:
        # Check which columns already exist
        result = db.execute(text("""
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = 'program_execution_logs'
            AND column_name IN ('environment', 'realized_pnl', 'pnl_updated_at')
        """))
        existing_columns = {row[0] for row in result.fetchall()}

        # Add environment column if not exists
        if 'environment' not in existing_columns:
            logger.info("Adding 'environment' column to program_execution_logs...")
            db.execute(text("""
                ALTER TABLE program_execution_logs
                ADD COLUMN environment VARCHAR(20)
            """))
            # Create index for environment column
            db.execute(text("""
                CREATE INDEX IF NOT EXISTS ix_program_execution_logs_environment
                ON program_execution_logs(environment)
            """))
            logger.info("Added 'environment' column with index")
        else:
            logger.info("Column 'environment' already exists, skipping")

        # Add realized_pnl column if not exists
        if 'realized_pnl' not in existing_columns:
            logger.info("Adding 'realized_pnl' column to program_execution_logs...")
            db.execute(text("""
                ALTER TABLE program_execution_logs
                ADD COLUMN realized_pnl DECIMAL(18, 6)
            """))
            logger.info("Added 'realized_pnl' column")
        else:
            logger.info("Column 'realized_pnl' already exists, skipping")

        # Add pnl_updated_at column if not exists
        if 'pnl_updated_at' not in existing_columns:
            logger.info("Adding 'pnl_updated_at' column to program_execution_logs...")
            db.execute(text("""
                ALTER TABLE program_execution_logs
                ADD COLUMN pnl_updated_at TIMESTAMP
            """))
            logger.info("Added 'pnl_updated_at' column")
        else:
            logger.info("Column 'pnl_updated_at' already exists, skipping")

        db.commit()
        logger.info("Migration completed successfully")
        return True

    except Exception as e:
        logger.error(f"Migration failed: {e}")
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run_migration()
