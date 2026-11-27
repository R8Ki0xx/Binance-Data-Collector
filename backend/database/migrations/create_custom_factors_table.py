"""
Create custom_factors table for user/AI-defined factor expressions.
Idempotent: checks if table exists before creating.
"""

from sqlalchemy import text
from database.connection import SessionLocal


def upgrade():
    db = SessionLocal()
    try:
        exists = db.execute(text(
            "SELECT EXISTS (SELECT 1 FROM information_schema.tables "
            "WHERE table_name = 'custom_factors')"
        )).scalar()
        if exists:
            return

        db.execute(text("""
            CREATE TABLE custom_factors (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                expression TEXT NOT NULL,
                description TEXT,
                category VARCHAR(30) NOT NULL DEFAULT 'custom',
                source VARCHAR(20) NOT NULL DEFAULT 'manual',
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT custom_factors_name_unique UNIQUE (name)
            )
        """))
        db.commit()
        print("[Migration] Created custom_factors table", flush=True)
    finally:
        db.close()
