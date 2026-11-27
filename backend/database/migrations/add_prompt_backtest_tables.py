"""
Migration: Add prompt backtest tables
Created: 2025-01-09

Creates tables for prompt backtest feature:
- prompt_backtest_tasks: Task management table
- prompt_backtest_items: Individual backtest items with results
"""

from sqlalchemy import text
from database.connection import engine


def upgrade():
    """Run the migration"""
    with engine.connect() as conn:
        # Create prompt_backtest_tasks table
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS prompt_backtest_tasks (
                id SERIAL PRIMARY KEY,
                account_id INTEGER NOT NULL REFERENCES accounts(id),
                wallet_address VARCHAR(100),
                environment VARCHAR(20),
                name VARCHAR(200),
                status VARCHAR(20) NOT NULL DEFAULT 'pending',
                total_count INTEGER NOT NULL DEFAULT 0,
                completed_count INTEGER NOT NULL DEFAULT 0,
                failed_count INTEGER NOT NULL DEFAULT 0,
                replace_rules TEXT,
                started_at TIMESTAMP,
                finished_at TIMESTAMP,
                error_message TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """))

        # Create indexes for prompt_backtest_tasks
        conn.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_backtest_tasks_account
            ON prompt_backtest_tasks(account_id)
        """))
        conn.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_backtest_tasks_wallet
            ON prompt_backtest_tasks(wallet_address)
        """))
        conn.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_backtest_tasks_created
            ON prompt_backtest_tasks(created_at)
        """))

        # Create prompt_backtest_items table
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS prompt_backtest_items (
                id SERIAL PRIMARY KEY,
                task_id INTEGER NOT NULL REFERENCES prompt_backtest_tasks(id) ON DELETE CASCADE,
                original_decision_log_id INTEGER NOT NULL REFERENCES ai_decision_logs(id),
                status VARCHAR(20) NOT NULL DEFAULT 'pending',
                error_message TEXT,
                original_operation VARCHAR(20),
                original_symbol VARCHAR(20),
                original_target_portion DECIMAL(10, 6),
                original_reasoning TEXT,
                original_decision_json TEXT,
                original_realized_pnl DECIMAL(18, 6),
                original_decision_time TIMESTAMP,
                original_prompt_template_name VARCHAR(200),
                modified_prompt TEXT,
                new_operation VARCHAR(20),
                new_symbol VARCHAR(20),
                new_target_portion DECIMAL(10, 6),
                new_reasoning TEXT,
                new_decision_json TEXT,
                decision_changed BOOLEAN,
                change_type VARCHAR(50),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """))

        # Create indexes for prompt_backtest_items
        conn.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_backtest_items_task
            ON prompt_backtest_items(task_id)
        """))
        conn.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_backtest_items_decision
            ON prompt_backtest_items(original_decision_log_id)
        """))

        conn.commit()
        print("Migration completed: Prompt backtest tables created")


def rollback():
    """Rollback the migration"""
    with engine.connect() as conn:
        conn.execute(text("DROP TABLE IF EXISTS prompt_backtest_items CASCADE"))
        conn.execute(text("DROP TABLE IF EXISTS prompt_backtest_tasks CASCADE"))
        conn.commit()
        print("Rollback completed: Prompt backtest tables dropped")


if __name__ == "__main__":
    upgrade()
