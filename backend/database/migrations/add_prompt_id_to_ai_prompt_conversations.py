"""
Migration: Add prompt_id to ai_prompt_conversations table

This allows conversations to be associated with specific prompt templates,
enabling filtering of conversation history by prompt.
"""
import logging
from sqlalchemy import text

logger = logging.getLogger(__name__)


def upgrade() -> None:
    """Add prompt_id column to ai_prompt_conversations table."""
    from database.connection import SessionLocal

    db = SessionLocal()
    try:
        # Check if column already exists (idempotent)
        result = db.execute(text("""
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = 'ai_prompt_conversations'
            AND column_name = 'prompt_id'
        """))

        if result.fetchone():
            logger.info("[MIGRATION] prompt_id column already exists in ai_prompt_conversations, skipping")
            return

        # Add the column
        logger.info("[MIGRATION] Adding prompt_id column to ai_prompt_conversations...")
        db.execute(text("""
            ALTER TABLE ai_prompt_conversations
            ADD COLUMN prompt_id INTEGER REFERENCES prompt_templates(id)
        """))

        # Create index for faster lookups
        db.execute(text("""
            CREATE INDEX IF NOT EXISTS ix_ai_prompt_conversations_prompt_id
            ON ai_prompt_conversations(prompt_id)
        """))

        db.commit()
        logger.info("[MIGRATION] Added prompt_id column to ai_prompt_conversations")
    except Exception as e:
        db.rollback()
        logger.error(f"[MIGRATION] Failed to add prompt_id: {e}")
        raise
    finally:
        db.close()
