"""
Add exchange field to signal_definitions and signal_pools tables.

This migration adds exchange support for multi-exchange signal detection.
Default value is 'hyperliquid' for backward compatibility.
"""

import logging
from sqlalchemy import text

logger = logging.getLogger(__name__)


def upgrade():
    """Add exchange column to signal tables if not exists."""
    from database.connection import SessionLocal

    db = SessionLocal()
    try:
        # Add exchange to signal_definitions
        result = db.execute(text("""
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'signal_definitions' AND column_name = 'exchange'
        """))
        if not result.fetchone():
            db.execute(text("""
                ALTER TABLE signal_definitions
                ADD COLUMN exchange VARCHAR(20) NOT NULL DEFAULT 'hyperliquid'
            """))
            db.commit()
            logger.info("Added 'exchange' column to signal_definitions table")
        else:
            logger.info("Column 'exchange' already exists in signal_definitions")

        # Add exchange to signal_pools
        result = db.execute(text("""
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'signal_pools' AND column_name = 'exchange'
        """))
        if not result.fetchone():
            db.execute(text("""
                ALTER TABLE signal_pools
                ADD COLUMN exchange VARCHAR(20) NOT NULL DEFAULT 'hyperliquid'
            """))
            db.commit()
            logger.info("Added 'exchange' column to signal_pools table")
        else:
            logger.info("Column 'exchange' already exists in signal_pools")

        logger.info("Migration add_exchange_to_signals completed successfully")
    except Exception as e:
        db.rollback()
        logger.error(f"Migration add_exchange_to_signals failed: {e}")
        raise
    finally:
        db.close()
