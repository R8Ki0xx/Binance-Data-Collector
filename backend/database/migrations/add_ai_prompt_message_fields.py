"""
Migration: Add reasoning_snapshot, tool_calls_log, is_complete fields to ai_prompt_messages table.

These fields align AiPromptMessage with AiProgramMessage to support:
- Tool calling (function calling) for AI prompt generation
- Reasoning/thinking process capture
- Retry/continue functionality for interrupted conversations

This migration is idempotent - safe to run multiple times.
"""

import logging
from sqlalchemy import text
from database.connection import SessionLocal

logger = logging.getLogger(__name__)


def upgrade():
    """Add new columns to ai_prompt_messages."""
    db = SessionLocal()
    try:
        # Define columns to add
        columns_to_add = [
            ("reasoning_snapshot", "TEXT"),
            ("tool_calls_log", "TEXT"),
            ("is_complete", "BOOLEAN DEFAULT TRUE"),
        ]

        for col_name, col_type in columns_to_add:
            # Check if column already exists
            result = db.execute(text("""
                SELECT column_name
                FROM information_schema.columns
                WHERE table_name = 'ai_prompt_messages'
                AND column_name = :col_name
            """), {"col_name": col_name})
            existing = result.fetchone()

            if existing:
                logger.info(f"Column '{col_name}' already exists in ai_prompt_messages, skipping")
                continue

            # Add column
            logger.info(f"Adding '{col_name}' column to ai_prompt_messages...")
            db.execute(text(f"""
                ALTER TABLE ai_prompt_messages
                ADD COLUMN {col_name} {col_type}
            """))
            logger.info(f"Added '{col_name}' column successfully")

        db.commit()
        logger.info("Migration completed: ai_prompt_messages fields aligned with ai_program_messages")
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
