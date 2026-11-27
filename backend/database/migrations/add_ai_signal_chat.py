"""
Migration: Add AI Signal Chat Tables

Creates tables for AI-assisted signal creation conversations:
- ai_signal_conversations: Stores conversation sessions
- ai_signal_messages: Stores individual messages in conversations
"""

from sqlalchemy import text
from database.connection import engine


def upgrade():
    """Run the migration"""
    with engine.connect() as conn:
        # Create ai_signal_conversations table
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS ai_signal_conversations (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                title VARCHAR(200) NOT NULL DEFAULT 'New Signal',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """))

        # Create index on user_id
        conn.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_ai_signal_conversations_user_id
            ON ai_signal_conversations(user_id)
        """))

        # Create ai_signal_messages table
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS ai_signal_messages (
                id SERIAL PRIMARY KEY,
                conversation_id INTEGER NOT NULL REFERENCES ai_signal_conversations(id) ON DELETE CASCADE,
                role VARCHAR(20) NOT NULL,
                content TEXT NOT NULL,
                signal_configs TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """))

        # Create index on conversation_id
        conn.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_ai_signal_messages_conversation_id
            ON ai_signal_messages(conversation_id)
        """))

        conn.commit()
        print("Migration completed: AI Signal Chat tables created")


def rollback():
    """Rollback the migration"""
    with engine.connect() as conn:
        conn.execute(text("DROP TABLE IF EXISTS ai_signal_messages CASCADE"))
        conn.execute(text("DROP TABLE IF EXISTS ai_signal_conversations CASCADE"))
        conn.commit()
        print("Rollback completed: AI Signal Chat tables dropped")


if __name__ == "__main__":
    upgrade()
