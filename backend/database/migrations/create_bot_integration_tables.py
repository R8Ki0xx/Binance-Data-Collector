"""Migration: Create Bot Integration tables

Creates:
- bot_configs: Store Telegram/Discord bot token and connection status

Extends:
- hyper_ai_conversations: Add is_bot_conversation and bot_platform fields
"""

import logging
from sqlalchemy import text

logger = logging.getLogger(__name__)


def upgrade():
    """Create bot integration tables and extend conversation table"""
    from database.connection import SessionLocal

    db = SessionLocal()
    try:
        # ============================================================
        # 1. Create bot_configs table
        # ============================================================
        result = db.execute(text("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_name = 'bot_configs'
            )
        """))
        table_exists = result.scalar()

        if not table_exists:
            logger.info("[MIGRATION] Creating bot_configs table...")
            db.execute(text("""
                CREATE TABLE bot_configs (
                    id SERIAL PRIMARY KEY,
                    platform VARCHAR(20) NOT NULL UNIQUE,
                    bot_token_encrypted TEXT,
                    bot_username VARCHAR(100),
                    bot_app_id VARCHAR(50),
                    status VARCHAR(20) NOT NULL DEFAULT 'disconnected',
                    error_message TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """))
            db.execute(text("""
                CREATE INDEX ix_bot_configs_platform ON bot_configs(platform)
            """))
            db.commit()
            logger.info("[MIGRATION] bot_configs table created")
        else:
            logger.info("[MIGRATION] bot_configs table already exists, skipping")

        # ============================================================
        # 2. Add is_bot_conversation to hyper_ai_conversations
        # ============================================================
        result = db.execute(text("""
            SELECT EXISTS (
                SELECT FROM information_schema.columns
                WHERE table_name = 'hyper_ai_conversations'
                AND column_name = 'is_bot_conversation'
            )
        """))
        col_exists = result.scalar()

        if not col_exists:
            logger.info("[MIGRATION] Adding is_bot_conversation to hyper_ai_conversations...")
            db.execute(text("""
                ALTER TABLE hyper_ai_conversations
                ADD COLUMN is_bot_conversation BOOLEAN DEFAULT FALSE
            """))
            db.commit()
            logger.info("[MIGRATION] is_bot_conversation column added")
        else:
            logger.info("[MIGRATION] is_bot_conversation column already exists, skipping")

        # ============================================================
        # 3. Add bot_platform to hyper_ai_conversations
        # ============================================================
        result = db.execute(text("""
            SELECT EXISTS (
                SELECT FROM information_schema.columns
                WHERE table_name = 'hyper_ai_conversations'
                AND column_name = 'bot_platform'
            )
        """))
        col_exists = result.scalar()

        if not col_exists:
            logger.info("[MIGRATION] Adding bot_platform to hyper_ai_conversations...")
            db.execute(text("""
                ALTER TABLE hyper_ai_conversations
                ADD COLUMN bot_platform VARCHAR(20)
            """))
            db.commit()
            logger.info("[MIGRATION] bot_platform column added")
        else:
            logger.info("[MIGRATION] bot_platform column already exists, skipping")

        logger.info("[MIGRATION] Bot integration migration completed successfully")

    except Exception as e:
        logger.error(f"[MIGRATION] Bot integration migration failed: {e}")
        db.rollback()
        raise
    finally:
        db.close()
