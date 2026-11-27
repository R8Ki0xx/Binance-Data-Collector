"""
Add exchange column to factor_effectiveness table.

Idempotent: checks if column exists before adding.
Also recreates the unique constraint to include exchange.
"""

from sqlalchemy import text
from database.connection import engine


def upgrade():
    with engine.connect() as conn:
        # Check if exchange column already exists
        result = conn.execute(text("""
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'factor_effectiveness' AND column_name = 'exchange'
        """)).fetchone()

        if not result:
            conn.execute(text(
                "ALTER TABLE factor_effectiveness "
                "ADD COLUMN exchange VARCHAR(20) NOT NULL DEFAULT 'hyperliquid'"
            ))
            conn.commit()
            print("[Migration] Added exchange column to factor_effectiveness")

        # Drop old unique constraint if exists, create new one with exchange
        try:
            conn.execute(text(
                "ALTER TABLE factor_effectiveness "
                "DROP CONSTRAINT IF EXISTS factor_effectiveness_unique_key"
            ))
            conn.commit()
        except Exception:
            pass

        try:
            conn.execute(text(
                "ALTER TABLE factor_effectiveness ADD CONSTRAINT factor_effectiveness_unique_key "
                "UNIQUE (exchange, factor_name, symbol, period, forward_period, calc_date)"
            ))
            conn.commit()
            print("[Migration] Recreated unique constraint with exchange")
        except Exception:
            pass  # Already exists


if __name__ == "__main__":
    upgrade()
