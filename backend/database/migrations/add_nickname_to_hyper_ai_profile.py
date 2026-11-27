#!/usr/bin/env python3
"""
Migration: Add nickname field to hyper_ai_profile table

Adds nickname column to store user's preferred name/nickname.
This migration is idempotent - safe to run multiple times.
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from sqlalchemy import create_engine, text
from database.connection import DATABASE_URL


def migrate():
    """Add nickname column to hyper_ai_profile if it doesn't exist."""
    engine = create_engine(DATABASE_URL)

    with engine.connect() as conn:
        # Check if column exists
        result = conn.execute(text("""
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'hyper_ai_profile' AND column_name = 'nickname'
        """))

        if result.fetchone() is None:
            conn.execute(text("""
                ALTER TABLE hyper_ai_profile
                ADD COLUMN nickname VARCHAR(100)
            """))
            conn.commit()
            print("✅ Added nickname column to hyper_ai_profile")
        else:
            print("✅ nickname column already exists in hyper_ai_profile")


def upgrade():
    """Entry point for migration manager"""
    migrate()


if __name__ == "__main__":
    migrate()
