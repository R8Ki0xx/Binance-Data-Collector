"""
Migration: Add is_complete field to ai_program_messages table.

This field enables retry/continue functionality for interrupted AI conversations:
- is_complete=True: Message completed successfully (default for existing records)
- is_complete=False: Message was interrupted, can be continued

This migration is idempotent - safe to run multiple times.
"""

import logging
from sqlalchemy import text
from database.connection import SessionLocal

logger = logging.getLogger(__name__)


def upgrade():
    """Add is_complete column to ai_program_messages."""
    db = SessionLocal()
    try:
        # Check if column already exists
        result = db.execute(text("""
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = 'ai_program_messages'
            AND column_name = 'is_complete'
        """))
        existing = result.fetchone()

        if existing:
            logger.info("Column 'is_complete' already exists in ai_program_messages, skipping")
            return True

        # Add is_complete column with default True (existing messages are complete)
        logger.info("Adding 'is_complete' column to ai_program_messages...")
        db.execute(text("""
            ALTER TABLE ai_program_messages
            ADD COLUMN is_complete BOOLEAN DEFAULT TRUE
        """))

        db.commit()
        logger.info("Migration completed: added 'is_complete' column to ai_program_messages")
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
