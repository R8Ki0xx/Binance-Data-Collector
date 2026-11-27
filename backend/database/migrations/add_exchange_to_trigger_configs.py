"""
Migration: Add exchange field to strategy config and program binding tables

Adds 'exchange' column to:
- account_strategy_configs: AI Trader trigger config
- account_program_bindings: Program binding config

Default value is 'hyperliquid' for backward compatibility.
"""

import logging
from sqlalchemy import text

logger = logging.getLogger(__name__)


def upgrade():
    """Add exchange field to trigger config tables"""
    from database.connection import SessionLocal

    db = SessionLocal()
    try:
        # Add exchange column to account_strategy_configs
        result = db.execute(text("""
            SELECT EXISTS (
                SELECT FROM information_schema.columns
                WHERE table_name = 'account_strategy_configs'
                AND column_name = 'exchange'
            )
        """))
        exists = result.scalar()

        if not exists:
            logger.info("[MIGRATION] Adding exchange column to account_strategy_configs...")
            db.execute(text("""
                ALTER TABLE account_strategy_configs
                ADD COLUMN exchange VARCHAR(20) NOT NULL DEFAULT 'hyperliquid'
            """))
            db.commit()
            logger.info("[MIGRATION] account_strategy_configs.exchange added")
        else:
            logger.info("[MIGRATION] account_strategy_configs.exchange already exists, skipping")

        # Add exchange column to account_program_bindings
        result = db.execute(text("""
            SELECT EXISTS (
                SELECT FROM information_schema.columns
                WHERE table_name = 'account_program_bindings'
                AND column_name = 'exchange'
            )
        """))
        exists = result.scalar()

        if not exists:
            logger.info("[MIGRATION] Adding exchange column to account_program_bindings...")
            db.execute(text("""
                ALTER TABLE account_program_bindings
                ADD COLUMN exchange VARCHAR(20) NOT NULL DEFAULT 'hyperliquid'
            """))
            db.commit()
            logger.info("[MIGRATION] account_program_bindings.exchange added")
        else:
            logger.info("[MIGRATION] account_program_bindings.exchange already exists, skipping")

        logger.info("Migration add_exchange_to_trigger_configs completed successfully")

    except Exception as e:
        db.rollback()
        logger.error(f"Migration add_exchange_to_trigger_configs failed: {e}")
        raise
    finally:
        db.close()
