#!/usr/bin/env python3
"""
Migration: Add enabled_skills field to hyper_ai_profile table

Adds enabled_skills column (Text, JSON array) to store which Skill modules
the user has enabled/disabled. When NULL, all skills are considered enabled
(default behavior for existing users).

Part of the Hyper AI Skill System:
- Skills are stored as SKILL.md files in backend/skills/
- This field controls which skills are visible to Hyper AI
- Format: JSON array of skill names, e.g. ["prompt-strategy-setup", "market-analysis"]
- NULL means all skills enabled (backward compatible)

This migration is idempotent - safe to run multiple times.
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from sqlalchemy import create_engine, text
from database.connection import DATABASE_URL


def migrate():
    """Add enabled_skills column to hyper_ai_profile if it doesn't exist."""
    engine = create_engine(DATABASE_URL)

    with engine.connect() as conn:
        # Check if column exists
        result = conn.execute(text("""
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'hyper_ai_profile' AND column_name = 'enabled_skills'
        """))

        if result.fetchone() is None:
            conn.execute(text("""
                ALTER TABLE hyper_ai_profile
                ADD COLUMN enabled_skills TEXT
            """))
            conn.commit()
            print("✅ Added enabled_skills column to hyper_ai_profile")
        else:
            print("✅ enabled_skills column already exists in hyper_ai_profile")


def upgrade():
    """Entry point for migration manager"""
    migrate()


if __name__ == "__main__":
    migrate()
