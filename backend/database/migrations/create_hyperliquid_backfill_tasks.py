"""
Create hyperliquid_backfill_tasks table for Hyperliquid K-line backfill tracking.
Structure mirrors binance_backfill_tasks for consistency.
"""
import logging
from sqlalchemy import text
from database.connection import SessionLocal

logger = logging.getLogger(__name__)


def upgrade():
    """Create hyperliquid_backfill_tasks table if not exists"""
    db = SessionLocal()
    try:
        # Check if table exists
        check_query = text("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_name = 'hyperliquid_backfill_tasks'
            )
        """)
        result = db.execute(check_query).scalar()

        if result:
            logger.info("Table hyperliquid_backfill_tasks already exists, skipping")
            return

        # Create table
        create_query = text("""
            CREATE TABLE hyperliquid_backfill_tasks (
                id SERIAL PRIMARY KEY,
                symbols VARCHAR(200) NOT NULL,
                status VARCHAR(20) NOT NULL DEFAULT 'pending',
                progress INTEGER NOT NULL DEFAULT 0,
                error_message TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        db.execute(create_query)

        # Create index on status
        index_query = text("""
            CREATE INDEX IF NOT EXISTS ix_hyperliquid_backfill_tasks_status
            ON hyperliquid_backfill_tasks(status)
        """)
        db.execute(index_query)

        db.commit()
        logger.info("Created table hyperliquid_backfill_tasks")

    except Exception as e:
        db.rollback()
        logger.error(f"Failed to create hyperliquid_backfill_tasks: {e}")
        raise
    finally:
        db.close()


def downgrade():
    """Drop hyperliquid_backfill_tasks table"""
    db = SessionLocal()
    try:
        db.execute(text("DROP TABLE IF EXISTS hyperliquid_backfill_tasks"))
        db.commit()
        logger.info("Dropped table hyperliquid_backfill_tasks")
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to drop hyperliquid_backfill_tasks: {e}")
        raise
    finally:
        db.close()
