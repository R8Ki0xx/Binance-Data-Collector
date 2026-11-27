"""
Migration: Add AI Attribution Chat Tables

Creates tables for AI-assisted attribution analysis conversations:
- ai_attribution_conversations: Stores conversation sessions
- ai_attribution_messages: Stores individual messages in conversations
"""

from sqlalchemy import text
from database.connection import engine


def upgrade():
    """Run the migration"""
    with engine.connect() as conn:
        # Create ai_attribution_conversations table
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS ai_attribution_conversations (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                title VARCHAR(200) NOT NULL DEFAULT 'New Analysis',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """))

        # Create index on user_id
        conn.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_ai_attribution_conversations_user_id
            ON ai_attribution_conversations(user_id)
        """))

        # Create ai_attribution_messages table
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS ai_attribution_messages (
                id SERIAL PRIMARY KEY,
                conversation_id INTEGER NOT NULL REFERENCES ai_attribution_conversations(id) ON DELETE CASCADE,
                role VARCHAR(20) NOT NULL,
                content TEXT NOT NULL,
                diagnosis_result TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """))

        # Create index on conversation_id
        conn.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_ai_attribution_messages_conversation_id
            ON ai_attribution_messages(conversation_id)
        """))

        conn.commit()
        print("Migration completed: AI Attribution Chat tables created")


def rollback():
    """Rollback the migration"""
    with engine.connect() as conn:
        conn.execute(text("DROP TABLE IF EXISTS ai_attribution_messages CASCADE"))
        conn.execute(text("DROP TABLE IF EXISTS ai_attribution_conversations CASCADE"))
        conn.commit()
        print("Rollback completed: AI Attribution Chat tables dropped")


if __name__ == "__main__":
    upgrade()
