"""
Create factor system tables: factor_values and factor_effectiveness.
Idempotent - checks if tables exist before creating.
"""
import logging
from database.connection import engine
from sqlalchemy import text

logger = logging.getLogger(__name__)


def upgrade():
    with engine.connect() as conn:
        # Check existing tables
        result = conn.execute(text(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema = 'public' AND table_name IN "
            "('factor_values', 'factor_effectiveness')"
        ))
        existing = {row[0] for row in result}

        if "factor_values" not in existing:
            conn.execute(text("""
                CREATE TABLE factor_values (
                    id SERIAL PRIMARY KEY,
                    exchange VARCHAR(20) NOT NULL DEFAULT 'hyperliquid',
                    symbol VARCHAR(20) NOT NULL,
                    period VARCHAR(10) NOT NULL,
                    factor_name VARCHAR(80) NOT NULL,
                    factor_category VARCHAR(30) NOT NULL,
                    timestamp INTEGER NOT NULL,
                    value FLOAT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    CONSTRAINT factor_values_unique_key
                        UNIQUE (exchange, symbol, period, factor_name, timestamp)
                )
            """))
            conn.execute(text(
                "CREATE INDEX idx_fv_symbol_period "
                "ON factor_values(symbol, period)"
            ))
            conn.execute(text(
                "CREATE INDEX idx_fv_factor_name "
                "ON factor_values(factor_name)"
            ))
            conn.execute(text(
                "CREATE INDEX idx_fv_timestamp "
                "ON factor_values(timestamp)"
            ))
            logger.info("Created factor_values table")

        if "factor_effectiveness" not in existing:
            conn.execute(text("""
                CREATE TABLE factor_effectiveness (
                    id SERIAL PRIMARY KEY,
                    factor_name VARCHAR(80) NOT NULL,
                    factor_category VARCHAR(30) NOT NULL,
                    symbol VARCHAR(20) NOT NULL,
                    period VARCHAR(10) NOT NULL,
                    forward_period VARCHAR(10) NOT NULL,
                    calc_date DATE NOT NULL,
                    lookback_days INTEGER NOT NULL DEFAULT 30,
                    ic_mean FLOAT,
                    ic_std FLOAT,
                    icir FLOAT,
                    win_rate FLOAT,
                    decay_half_life INTEGER,
                    sample_count INTEGER,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    CONSTRAINT factor_effectiveness_unique_key
                        UNIQUE (factor_name, symbol, period,
                                forward_period, calc_date)
                )
            """))
            conn.execute(text(
                "CREATE INDEX idx_fe_calc_date "
                "ON factor_effectiveness(calc_date)"
            ))
            conn.execute(text(
                "CREATE INDEX idx_fe_factor_symbol "
                "ON factor_effectiveness(factor_name, symbol, calc_date)"
            ))
            logger.info("Created factor_effectiveness table")

        conn.commit()
