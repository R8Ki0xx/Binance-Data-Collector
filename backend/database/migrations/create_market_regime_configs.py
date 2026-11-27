#!/usr/bin/env python3
"""
Migration: Create Market Regime Configs Table
- market_regime_configs: Configuration for Market Regime classification thresholds

Note: Config field names use '_z' suffix for historical reasons,
but actual values are ratio-based thresholds, not z-scores.
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from sqlalchemy import create_engine, text
from database.connection import DATABASE_URL

# Default values (updated 2024-12: redesigned classification logic)
DEFAULT_BREAKOUT_OI_Z = 0.1       # OI increase threshold for breakout
DEFAULT_BREAKOUT_PRICE_ATR = 0.3  # Price movement threshold
DEFAULT_TRAP_OI_Z = -0.5          # OI decrease threshold for trap
DEFAULT_TAKER_HIGH = 33.0         # Taker ratio high threshold (~25% extreme)
DEFAULT_TAKER_LOW = 0.03          # Taker ratio low threshold (~25% extreme)


def migrate():
    """Create market_regime_configs table with idempotency"""
    engine = create_engine(DATABASE_URL)

    with engine.connect() as conn:
        # Check if table exists
        result = conn.execute(text("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_name = 'market_regime_configs'
            )
        """))
        table_exists = result.scalar()

        if table_exists:
            print("market_regime_configs table already exists, skipping creation")
            # Update to new defaults (2024-12 redesign)
            # Update breakout_oi_z: 0.3 -> 0.1 (for OI increase detection)
            result = conn.execute(text("""
                UPDATE market_regime_configs
                SET breakout_oi_z = :new_oi
                WHERE is_default = true AND breakout_oi_z = 0.3
            """), {"new_oi": DEFAULT_BREAKOUT_OI_Z})
            if result.rowcount > 0:
                print(f"Updated breakout_oi_z: 0.3 -> {DEFAULT_BREAKOUT_OI_Z}")

            # Update trap_oi_z: -1.0 -> -0.5 (for OI decrease detection)
            result = conn.execute(text("""
                UPDATE market_regime_configs
                SET trap_oi_z = :new_trap
                WHERE is_default = true AND trap_oi_z = -1.0
            """), {"new_trap": DEFAULT_TRAP_OI_Z})
            if result.rowcount > 0:
                print(f"Updated trap_oi_z: -1.0 -> {DEFAULT_TRAP_OI_Z}")

            # Update taker thresholds: 1.8/0.55 -> 33/0.03 (for ~25% extreme)
            result = conn.execute(text("""
                UPDATE market_regime_configs
                SET breakout_taker_high = :new_high, breakout_taker_low = :new_low
                WHERE is_default = true AND breakout_taker_high = 1.8 AND breakout_taker_low = 0.55
            """), {"new_high": DEFAULT_TAKER_HIGH, "new_low": DEFAULT_TAKER_LOW})
            if result.rowcount > 0:
                print(f"Updated taker thresholds: 1.8/0.55 -> {DEFAULT_TAKER_HIGH}/{DEFAULT_TAKER_LOW}")
        else:
            # Create table with new default values
            conn.execute(text("""
                CREATE TABLE market_regime_configs (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(100) NOT NULL,
                    is_default BOOLEAN DEFAULT false,
                    rolling_window INTEGER DEFAULT 48,
                    breakout_cvd_z FLOAT DEFAULT 1.5,
                    breakout_oi_z FLOAT DEFAULT 0.3,
                    breakout_price_atr FLOAT DEFAULT 0.3,
                    breakout_taker_high FLOAT DEFAULT 1.8,
                    breakout_taker_low FLOAT DEFAULT 0.55,
                    absorption_cvd_z FLOAT DEFAULT 1.5,
                    absorption_price_atr FLOAT DEFAULT 0.3,
                    trap_cvd_z FLOAT DEFAULT 1.0,
                    trap_oi_z FLOAT DEFAULT -1.0,
                    exhaustion_cvd_z FLOAT DEFAULT 1.0,
                    exhaustion_rsi_high FLOAT DEFAULT 70.0,
                    exhaustion_rsi_low FLOAT DEFAULT 30.0,
                    stop_hunt_range_atr FLOAT DEFAULT 1.0,
                    stop_hunt_close_atr FLOAT DEFAULT 0.3,
                    noise_cvd_z FLOAT DEFAULT 0.5,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """))
            print("market_regime_configs table created")

        # Check if default config exists, insert if not (idempotent)
        result = conn.execute(text("""
            SELECT COUNT(*) FROM market_regime_configs WHERE is_default = true
        """))
        default_exists = result.scalar() > 0

        if not default_exists:
            conn.execute(text("""
                INSERT INTO market_regime_configs (
                    name, is_default, rolling_window,
                    breakout_cvd_z, breakout_oi_z, breakout_price_atr,
                    breakout_taker_high, breakout_taker_low,
                    absorption_cvd_z, absorption_price_atr,
                    trap_cvd_z, trap_oi_z,
                    exhaustion_cvd_z, exhaustion_rsi_high, exhaustion_rsi_low,
                    stop_hunt_range_atr, stop_hunt_close_atr, noise_cvd_z
                ) VALUES (
                    'Default', true, 48,
                    1.5, 0.3, 0.3, 1.8, 0.55,
                    1.5, 0.3,
                    1.0, -1.0,
                    1.0, 70.0, 30.0,
                    1.0, 0.3, 0.5
                )
            """))
            print("Default config inserted")

        conn.commit()
        print("Market Regime configs migration completed")


def upgrade():
    """Entry point for migration manager"""
    migrate()


if __name__ == "__main__":
    migrate()
