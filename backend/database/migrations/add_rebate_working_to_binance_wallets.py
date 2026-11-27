"""
Migration: Add rebate_working field to binance_wallets table

This field caches the Binance API broker rebate eligibility status.
- True: User is eligible for rebate (no daily quota limit)
- False: User is not eligible (subject to 20 decisions/day limit for non-premium)
- NULL: Legacy data, status unknown
"""

import logging
from sqlalchemy import text

logger = logging.getLogger(__name__)


def upgrade():
    """Add rebate_working column to binance_wallets table"""
    from database.connection import SessionLocal

    db = SessionLocal()
    try:
        # Check if column already exists
        result = db.execute(text("""
            SELECT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'binance_wallets'
                AND column_name = 'rebate_working'
            )
        """))

        if result.scalar():
            logger.info("[MIGRATION] rebate_working column already exists in binance_wallets")
            return

        # Add the column
        db.execute(text("""
            ALTER TABLE binance_wallets
            ADD COLUMN rebate_working BOOLEAN DEFAULT NULL
        """))
        db.commit()

        logger.info("[MIGRATION] Added rebate_working column to binance_wallets table")

    except Exception as e:
        db.rollback()
        logger.error(f"Migration add_rebate_working_to_binance_wallets failed: {e}")
        raise
    finally:
        db.close()
