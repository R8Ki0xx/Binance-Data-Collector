"""
Migration: Add interrupt_reason field to ai_program_messages and ai_prompt_messages tables.

This field records the reason when an AI conversation is interrupted:
- API timeout
- API error (with status code)
- Network error
- etc.

This migration is idempotent - safe to run multiple times.
"""

import logging
from sqlalchemy import text
from database.connection import SessionLocal

logger = logging.getLogger(__name__)


def upgrade():
    """Add interrupt_reason column to AI message tables."""
    db = SessionLocal()
    try:
        tables = ["ai_program_messages", "ai_prompt_messages"]

        for table_name in tables:
            # Check if column already exists
            result = db.execute(text(f"""
                SELECT column_name
                FROM information_schema.columns
                WHERE table_name = '{table_name}'
                AND column_name = 'interrupt_reason'
            """))
            existing = result.fetchone()

            if existing:
                logger.info(f"Column 'interrupt_reason' already exists in {table_name}, skipping")
                continue

            # Add interrupt_reason column
            logger.info(f"Adding 'interrupt_reason' column to {table_name}...")
            db.execute(text(f"""
                ALTER TABLE {table_name}
                ADD COLUMN interrupt_reason TEXT DEFAULT NULL
            """))
            logger.info(f"Added 'interrupt_reason' column to {table_name}")

        db.commit()
        logger.info("Migration completed: added 'interrupt_reason' column to AI message tables")
        return True

    except Exception as e:
        logger.error(f"Migration failed: {e}")
        db.rollback()
        raise
    finally:
        db.close()


# Alias for migration_manager compatibility
def run_migration():
    return upgrade()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    upgrade()
