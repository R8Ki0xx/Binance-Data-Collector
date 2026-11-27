#!/usr/bin/env python3
"""
Migration: Add agent wallet fields to hyperliquid_wallets table.

New columns:
- key_type: VARCHAR(20), NOT NULL, DEFAULT 'private_key'
- master_wallet_address: VARCHAR(100), nullable
- agent_valid_until: TIMESTAMP, nullable

Idempotent: checks column existence before adding.
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from sqlalchemy import create_engine, text
from database.connection import DATABASE_URL


def _column_exists(conn, table: str, column: str) -> bool:
    result = conn.execute(text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_name = :table AND column_name = :column"
    ), {"table": table, "column": column})
    return result.fetchone() is not None


def upgrade():
    engine = create_engine(DATABASE_URL)
    with engine.connect() as conn:
        if not _column_exists(conn, "hyperliquid_wallets", "key_type"):
            conn.execute(text(
                "ALTER TABLE hyperliquid_wallets "
                "ADD COLUMN key_type VARCHAR(20) NOT NULL DEFAULT 'private_key'"
            ))
            conn.commit()

        if not _column_exists(conn, "hyperliquid_wallets", "master_wallet_address"):
            conn.execute(text(
                "ALTER TABLE hyperliquid_wallets "
                "ADD COLUMN master_wallet_address VARCHAR(100)"
            ))
            conn.commit()

        if not _column_exists(conn, "hyperliquid_wallets", "agent_valid_until"):
            conn.execute(text(
                "ALTER TABLE hyperliquid_wallets "
                "ADD COLUMN agent_valid_until TIMESTAMP"
            ))
            conn.commit()


if __name__ == "__main__":
    upgrade()
    print("Migration complete: agent wallet fields added")
