#!/usr/bin/env python3
"""
Migration 031: Create Hyper AI tables

Hyper AI is the master agent for full-site AI intelligence:
- hyper_ai_profile: User trading preferences and LLM configuration
- hyper_ai_memory: AI-extracted user insights (preferences, decisions, lessons)
- hyper_ai_conversations: Conversation sessions with compression support
- hyper_ai_messages: Individual messages with reasoning and tool call logs

This migration is idempotent - safe to run multiple times.
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from sqlalchemy import create_engine, text
from database.connection import DATABASE_URL


def migrate():
    """Create Hyper AI tables if they don't exist."""
    engine = create_engine(DATABASE_URL)

    with engine.connect() as conn:
        # 1. Create hyper_ai_profile table
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS hyper_ai_profile (
                id SERIAL PRIMARY KEY,

                -- Trading preferences (collected during onboarding)
                trading_style VARCHAR(50),
                risk_preference VARCHAR(50),
                experience_level VARCHAR(50),
                preferred_symbols TEXT,
                preferred_timeframe VARCHAR(50),
                capital_scale VARCHAR(50),

                -- Onboarding status
                onboarding_completed BOOLEAN DEFAULT FALSE,

                -- LLM provider configuration
                llm_provider VARCHAR(50),
                llm_base_url VARCHAR(500),
                llm_api_key_encrypted TEXT,
                llm_model VARCHAR(100),

                -- Timestamps
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """))
        print("[Migration 031] hyper_ai_profile table ready")

        # 2. Create hyper_ai_memory table
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS hyper_ai_memory (
                id SERIAL PRIMARY KEY,

                -- Memory content
                category VARCHAR(50) NOT NULL,
                content TEXT NOT NULL,

                -- Memory metadata
                source VARCHAR(50),
                importance FLOAT DEFAULT 0.5,
                is_active BOOLEAN DEFAULT TRUE,

                -- Timestamps
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """))
        print("[Migration 031] hyper_ai_memory table ready")

        # Create index on category for faster filtering
        conn.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_hyper_ai_memory_category
            ON hyper_ai_memory(category)
        """))

        # Create index on created_at for time-based queries
        conn.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_hyper_ai_memory_created_at
            ON hyper_ai_memory(created_at)
        """))

        # 3. Create hyper_ai_conversations table
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS hyper_ai_conversations (
                id SERIAL PRIMARY KEY,

                -- Conversation metadata
                title VARCHAR(200) NOT NULL DEFAULT 'Hyper AI Chat',

                -- Compression data
                summary TEXT,
                message_count INTEGER DEFAULT 0,
                total_tokens INTEGER DEFAULT 0,

                -- Timestamps
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                compressed_at TIMESTAMP
            )
        """))
        print("[Migration 031] hyper_ai_conversations table ready")

        # 4. Create hyper_ai_messages table
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS hyper_ai_messages (
                id SERIAL PRIMARY KEY,
                conversation_id INTEGER NOT NULL REFERENCES hyper_ai_conversations(id) ON DELETE CASCADE,

                -- Message content
                role VARCHAR(20) NOT NULL,
                content TEXT NOT NULL,

                -- AI reasoning and tool usage
                reasoning_snapshot TEXT,
                tool_calls_log TEXT,
                subagent_calls_log TEXT,

                -- Completion status
                is_complete BOOLEAN DEFAULT TRUE,
                interrupt_reason TEXT,

                -- Token tracking
                token_count INTEGER,

                -- Timestamps
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """))
        print("[Migration 031] hyper_ai_messages table ready")

        # Create index on conversation_id for faster message retrieval
        conn.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_hyper_ai_messages_conversation_id
            ON hyper_ai_messages(conversation_id)
        """))

        # Create index on created_at for time-based ordering
        conn.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_hyper_ai_messages_created_at
            ON hyper_ai_messages(created_at)
        """))

        conn.commit()
        print("✅ [Migration 031] All Hyper AI tables created successfully")


def upgrade():
    """Entry point for migration manager"""
    migrate()


if __name__ == "__main__":
    migrate()
