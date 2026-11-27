"""
Migration: Add Binance wallet and snapshot tables

Creates:
- binance_wallets: Store Binance Futures API credentials per AI Trader per environment
- binance_account_snapshots: Store Binance account state snapshots
"""

import logging
from sqlalchemy import text

logger = logging.getLogger(__name__)


def upgrade():
    """Create Binance wallet and snapshot tables"""
    from database.connection import SessionLocal

    db = SessionLocal()
    try:
        # Check if binance_wallets table exists
        result = db.execute(text("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_name = 'binance_wallets'
            )
        """))
        wallets_exists = result.scalar()

        if not wallets_exists:
            logger.info("[MIGRATION] Creating binance_wallets table...")
            db.execute(text("""
                CREATE TABLE binance_wallets (
                    id SERIAL PRIMARY KEY,
                    account_id INTEGER NOT NULL REFERENCES accounts(id),
                    environment VARCHAR(20) NOT NULL,
                    api_key_encrypted VARCHAR(500) NOT NULL,
                    secret_key_encrypted VARCHAR(500) NOT NULL,
                    max_leverage INTEGER NOT NULL DEFAULT 20,
                    default_leverage INTEGER NOT NULL DEFAULT 1,
                    is_active VARCHAR(10) NOT NULL DEFAULT 'true',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    CONSTRAINT uq_binance_wallets_account_environment
                        UNIQUE (account_id, environment)
                )
            """))
            db.execute(text("""
                CREATE INDEX ix_binance_wallets_account_id
                ON binance_wallets(account_id)
            """))
            db.commit()
            logger.info("[MIGRATION] binance_wallets table created")
        else:
            logger.info("[MIGRATION] binance_wallets table already exists, skipping")

        # Check if binance_account_snapshots table exists
        result = db.execute(text("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_name = 'binance_account_snapshots'
            )
        """))
        snapshots_exists = result.scalar()

        if not snapshots_exists:
            logger.info("[MIGRATION] Creating binance_account_snapshots table...")
            db.execute(text("""
                CREATE TABLE binance_account_snapshots (
                    id SERIAL PRIMARY KEY,
                    account_id INTEGER NOT NULL REFERENCES accounts(id),
                    environment VARCHAR(20) NOT NULL,
                    snapshot_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    total_wallet_balance DECIMAL(18, 6) NOT NULL,
                    available_balance DECIMAL(18, 6) NOT NULL,
                    total_unrealized_profit DECIMAL(18, 6) NOT NULL,
                    total_margin_balance DECIMAL(18, 6) NOT NULL,
                    total_initial_margin DECIMAL(18, 6),
                    total_maint_margin DECIMAL(18, 6),
                    trigger_event VARCHAR(50),
                    snapshot_data TEXT
                )
            """))
            db.execute(text("""
                CREATE INDEX ix_binance_account_snapshots_account_id
                ON binance_account_snapshots(account_id)
            """))
            db.execute(text("""
                CREATE INDEX ix_binance_account_snapshots_environment
                ON binance_account_snapshots(environment)
            """))
            db.execute(text("""
                CREATE INDEX ix_binance_account_snapshots_snapshot_time
                ON binance_account_snapshots(snapshot_time)
            """))
            db.commit()
            logger.info("[MIGRATION] binance_account_snapshots table created")
        else:
            logger.info("[MIGRATION] binance_account_snapshots table already exists, skipping")

        logger.info("Migration add_binance_wallet_tables completed successfully")

    except Exception as e:
        db.rollback()
        logger.error(f"Migration add_binance_wallet_tables failed: {e}")
        raise
    finally:
        db.close()
