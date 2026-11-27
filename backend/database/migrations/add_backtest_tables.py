"""
Migration: Add backtest tables for storing backtest results and trigger logs.

Designed to support both Program backtest and future Prompt backtest.
"""
import logging
from sqlalchemy import text
from database.connection import engine

logger = logging.getLogger(__name__)


def upgrade():
    """Entry point for migration manager."""
    run_migration(engine)


def run_migration(engine):
    """Create backtest_results and backtest_trigger_logs tables."""
    with engine.connect() as conn:
        # Check if backtest_results table exists
        result = conn.execute(text("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_name = 'backtest_results'
            )
        """))
        if result.scalar():
            logger.info("⏭️  Table backtest_results already exists, skipping")
        else:
            conn.execute(text("""
                CREATE TABLE backtest_results (
                    id SERIAL PRIMARY KEY,
                    backtest_type VARCHAR(20) NOT NULL DEFAULT 'program',
                    binding_id INTEGER,
                    prompt_id INTEGER,
                    user_id INTEGER,
                    config JSONB,
                    start_time TIMESTAMP,
                    end_time TIMESTAMP,
                    initial_balance FLOAT DEFAULT 10000,
                    final_equity FLOAT,
                    total_pnl FLOAT DEFAULT 0,
                    total_pnl_percent FLOAT DEFAULT 0,
                    max_drawdown FLOAT DEFAULT 0,
                    max_drawdown_percent FLOAT DEFAULT 0,
                    total_triggers INTEGER DEFAULT 0,
                    total_trades INTEGER DEFAULT 0,
                    winning_trades INTEGER DEFAULT 0,
                    losing_trades INTEGER DEFAULT 0,
                    win_rate FLOAT DEFAULT 0,
                    profit_factor FLOAT DEFAULT 0,
                    sharpe_ratio FLOAT,
                    equity_curve JSONB,
                    execution_time_ms INTEGER,
                    status VARCHAR(20) DEFAULT 'running',
                    error_message TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    completed_at TIMESTAMP,
                    CONSTRAINT chk_backtest_type CHECK (backtest_type IN ('program', 'prompt'))
                )
            """))
            conn.execute(text("""
                CREATE INDEX idx_backtest_results_user_id ON backtest_results(user_id)
            """))
            conn.execute(text("""
                CREATE INDEX idx_backtest_results_binding_id ON backtest_results(binding_id)
            """))
            conn.execute(text("""
                CREATE INDEX idx_backtest_results_type ON backtest_results(backtest_type)
            """))
            logger.info("✅ Created table backtest_results")

        # Check if backtest_trigger_logs table exists
        result = conn.execute(text("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_name = 'backtest_trigger_logs'
            )
        """))
        if result.scalar():
            logger.info("⏭️  Table backtest_trigger_logs already exists, skipping")
        else:
            conn.execute(text("""
                CREATE TABLE backtest_trigger_logs (
                    id SERIAL PRIMARY KEY,
                    backtest_id INTEGER NOT NULL REFERENCES backtest_results(id) ON DELETE CASCADE,
                    trigger_index INTEGER NOT NULL,
                    trigger_type VARCHAR(20),
                    trigger_time TIMESTAMP,
                    symbol VARCHAR(20),
                    decision_type VARCHAR(20) DEFAULT 'program',
                    decision_action VARCHAR(20),
                    decision_symbol VARCHAR(20),
                    decision_side VARCHAR(10),
                    decision_size FLOAT,
                    decision_reason TEXT,
                    entry_price FLOAT,
                    exit_price FLOAT,
                    pnl FLOAT,
                    equity_before FLOAT,
                    equity_after FLOAT,
                    decision_input JSONB,
                    decision_output JSONB,
                    execution_error TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    CONSTRAINT chk_decision_type CHECK (decision_type IN ('program', 'ai'))
                )
            """))
            conn.execute(text("""
                CREATE INDEX idx_trigger_logs_backtest_id ON backtest_trigger_logs(backtest_id)
            """))
            conn.execute(text("""
                CREATE INDEX idx_trigger_logs_trigger_index ON backtest_trigger_logs(trigger_index)
            """))
            logger.info("✅ Created table backtest_trigger_logs")

        conn.commit()
