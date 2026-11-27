#!/usr/bin/env python3
"""
Migration: Create Signal System Tables
- signal_definitions: Signal definition with trigger conditions
- signal_pools: Signal pool grouping multiple signals
- trader_trigger_config: AI Trader trigger configuration
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from sqlalchemy import create_engine, text
from database.connection import DATABASE_URL


def migrate():
    """Create signal system tables"""
    engine = create_engine(DATABASE_URL)

    with engine.connect() as conn:
        # 1. Create signal_definitions table
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS signal_definitions (
                id SERIAL PRIMARY KEY,
                signal_name VARCHAR(100) NOT NULL,
                description TEXT,
                trigger_condition TEXT NOT NULL,
                enabled BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """))

        # 2. Create indexes for signal_definitions
        conn.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_signal_definitions_enabled
            ON signal_definitions(enabled);

            CREATE INDEX IF NOT EXISTS idx_signal_definitions_created_at
            ON signal_definitions(created_at DESC);
        """))

        # 3. Create signal_pools table
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS signal_pools (
                id SERIAL PRIMARY KEY,
                pool_name VARCHAR(100) NOT NULL,
                signal_ids TEXT NOT NULL DEFAULT '[]',
                symbols TEXT NOT NULL DEFAULT '[]',
                enabled BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """))

        # 4. Create indexes for signal_pools
        conn.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_signal_pools_enabled
            ON signal_pools(enabled);
        """))

        # 5. Create trader_trigger_config table
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS trader_trigger_config (
                trader_id UUID PRIMARY KEY,
                scheduled_enabled BOOLEAN DEFAULT true,
                scheduled_interval INTEGER DEFAULT 30,
                signal_pool_id INTEGER REFERENCES signal_pools(id) ON DELETE SET NULL,
                last_trigger_time TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """))

        # 6. Create indexes for trader_trigger_config
        conn.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_trader_trigger_config_signal_pool_id
            ON trader_trigger_config(signal_pool_id);
        """))

        # 7. Create signal_trigger_logs table for tracking trigger history
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS signal_trigger_logs (
                id SERIAL PRIMARY KEY,
                signal_id INTEGER REFERENCES signal_definitions(id) ON DELETE CASCADE,
                pool_id INTEGER REFERENCES signal_pools(id) ON DELETE CASCADE,
                symbol VARCHAR(20) NOT NULL,
                trigger_value TEXT,
                triggered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """))

        # 8. Create indexes for signal_trigger_logs
        conn.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_signal_trigger_logs_signal_id
            ON signal_trigger_logs(signal_id);

            CREATE INDEX IF NOT EXISTS idx_signal_trigger_logs_pool_id
            ON signal_trigger_logs(pool_id);

            CREATE INDEX IF NOT EXISTS idx_signal_trigger_logs_triggered_at
            ON signal_trigger_logs(triggered_at DESC);

            CREATE INDEX IF NOT EXISTS idx_signal_trigger_logs_symbol
            ON signal_trigger_logs(symbol);
        """))

        conn.commit()
        print("Signal system database tables created successfully")
        print("   - signal_definitions table created")
        print("   - signal_pools table created")
        print("   - trader_trigger_config table created")
        print("   - signal_trigger_logs table created")


def upgrade():
    """Entry point for migration manager"""
    migrate()


if __name__ == "__main__":
    migrate()
