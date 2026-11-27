"""
Migration: Unify AI message table fields for shared infrastructure

This migration:
1. Adds reasoning_snapshot, tool_calls_log, is_complete to ai_signal_messages
2. Renames analysis_log to tool_calls_log in ai_attribution_messages
3. Adds is_complete to ai_attribution_messages

All AI assistant message tables will have consistent fields after this migration.
"""
import logging
from sqlalchemy import text

logger = logging.getLogger(__name__)


def upgrade() -> None:
    """Unify AI message table fields."""
    from database.connection import SessionLocal

    db = SessionLocal()
    try:
        # ========== ai_signal_messages: Add missing fields ==========

        # Check and add reasoning_snapshot
        result = db.execute(text("""
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'ai_signal_messages' AND column_name = 'reasoning_snapshot'
        """))
        if not result.fetchone():
            logger.info("[MIGRATION] Adding reasoning_snapshot to ai_signal_messages...")
            db.execute(text("""
                ALTER TABLE ai_signal_messages ADD COLUMN reasoning_snapshot TEXT
            """))

        # Check and add tool_calls_log
        result = db.execute(text("""
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'ai_signal_messages' AND column_name = 'tool_calls_log'
        """))
        if not result.fetchone():
            logger.info("[MIGRATION] Adding tool_calls_log to ai_signal_messages...")
            db.execute(text("""
                ALTER TABLE ai_signal_messages ADD COLUMN tool_calls_log TEXT
            """))

        # Check and add is_complete
        result = db.execute(text("""
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'ai_signal_messages' AND column_name = 'is_complete'
        """))
        if not result.fetchone():
            logger.info("[MIGRATION] Adding is_complete to ai_signal_messages...")
            db.execute(text("""
                ALTER TABLE ai_signal_messages ADD COLUMN is_complete BOOLEAN DEFAULT TRUE
            """))

        # ========== ai_attribution_messages: Rename and add fields ==========

        # Check if analysis_log exists and tool_calls_log doesn't
        result = db.execute(text("""
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'ai_attribution_messages' AND column_name = 'analysis_log'
        """))
        has_analysis_log = result.fetchone() is not None

        result = db.execute(text("""
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'ai_attribution_messages' AND column_name = 'tool_calls_log'
        """))
        has_tool_calls_log = result.fetchone() is not None

        if has_analysis_log and not has_tool_calls_log:
            logger.info("[MIGRATION] Renaming analysis_log to tool_calls_log in ai_attribution_messages...")
            db.execute(text("""
                ALTER TABLE ai_attribution_messages RENAME COLUMN analysis_log TO tool_calls_log
            """))
        elif not has_analysis_log and not has_tool_calls_log:
            logger.info("[MIGRATION] Adding tool_calls_log to ai_attribution_messages...")
            db.execute(text("""
                ALTER TABLE ai_attribution_messages ADD COLUMN tool_calls_log TEXT
            """))

        # Check and add is_complete
        result = db.execute(text("""
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'ai_attribution_messages' AND column_name = 'is_complete'
        """))
        if not result.fetchone():
            logger.info("[MIGRATION] Adding is_complete to ai_attribution_messages...")
            db.execute(text("""
                ALTER TABLE ai_attribution_messages ADD COLUMN is_complete BOOLEAN DEFAULT TRUE
            """))

        db.commit()
        logger.info("[MIGRATION] AI message fields unified successfully")
    except Exception as e:
        db.rollback()
        logger.error(f"[MIGRATION] Failed to unify AI message fields: {e}")
        raise
    finally:
        db.close()
