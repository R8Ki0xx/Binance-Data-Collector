"""
Create Program Trader tables with N:N binding architecture.

Tables:
- trading_programs: Reusable strategy code templates
- account_program_bindings: N:N binding between AI Trader and Programs with trigger config
- program_execution_logs: Execution history

Usage:
    cd /home/wwwroot/hyper-alpha-arena-prod/backend
    python database/migrations/create_program_trader_tables.py
"""
import os
import sys

from sqlalchemy import inspect, text

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECT_ROOT = os.path.dirname(BASE_DIR)
sys.path.insert(0, PROJECT_ROOT)

from database.connection import engine  # noqa: E402


def table_exists(inspector, table: str) -> bool:
    return table in inspector.get_table_names()


def upgrade() -> None:
    inspector = inspect(engine)

    with engine.connect() as conn:
        # =====================================================================
        # 1. trading_programs - Reusable strategy code templates
        # =====================================================================
        if not table_exists(inspector, "trading_programs"):
            conn.execute(text("""
                CREATE TABLE trading_programs (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id),
                    name VARCHAR(100) NOT NULL,
                    description TEXT,
                    code TEXT NOT NULL,
                    params TEXT,
                    icon VARCHAR(50),
                    last_backtest_result TEXT,
                    last_backtest_at TIMESTAMP,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """))
            conn.execute(text("CREATE INDEX idx_trading_programs_user_id ON trading_programs(user_id)"))
            conn.commit()
            print("✅ Created table: trading_programs")
        else:
            print("⏭️ Table trading_programs already exists, skipping")

        # =====================================================================
        # 2. account_program_bindings - N:N binding with trigger config
        # =====================================================================
        if not table_exists(inspector, "account_program_bindings"):
            conn.execute(text("""
                CREATE TABLE account_program_bindings (
                    id SERIAL PRIMARY KEY,
                    account_id INTEGER NOT NULL REFERENCES accounts(id),
                    program_id INTEGER NOT NULL REFERENCES trading_programs(id),
                    signal_pool_ids TEXT,
                    trigger_interval INTEGER NOT NULL DEFAULT 300,
                    scheduled_trigger_enabled BOOLEAN NOT NULL DEFAULT FALSE,
                    is_active BOOLEAN NOT NULL DEFAULT TRUE,
                    last_trigger_at TIMESTAMP,
                    params_override TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(account_id, program_id)
                )
            """))
            conn.execute(text("CREATE INDEX idx_apb_account_id ON account_program_bindings(account_id)"))
            conn.execute(text("CREATE INDEX idx_apb_program_id ON account_program_bindings(program_id)"))
            conn.commit()
            print("✅ Created table: account_program_bindings")
        else:
            print("⏭️ Table account_program_bindings already exists, skipping")

        # =====================================================================
        # 3. program_execution_logs - Execution history
        # =====================================================================
        if not table_exists(inspector, "program_execution_logs"):
            conn.execute(text("""
                CREATE TABLE program_execution_logs (
                    id SERIAL PRIMARY KEY,
                    binding_id INTEGER NOT NULL REFERENCES account_program_bindings(id),
                    account_id INTEGER NOT NULL REFERENCES accounts(id),
                    program_id INTEGER NOT NULL REFERENCES trading_programs(id),
                    trigger_type VARCHAR(20) NOT NULL,
                    trigger_symbol VARCHAR(20),
                    signal_pool_id INTEGER,
                    wallet_address VARCHAR(100),
                    success BOOLEAN NOT NULL,
                    decision_action VARCHAR(20),
                    decision_symbol VARCHAR(20),
                    decision_size_usd FLOAT,
                    decision_leverage INTEGER,
                    decision_reason TEXT,
                    decision_json TEXT,
                    error_message TEXT,
                    execution_time_ms FLOAT,
                    market_context TEXT,
                    params_snapshot TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """))
            conn.execute(text("CREATE INDEX idx_pel_binding_id ON program_execution_logs(binding_id)"))
            conn.execute(text("CREATE INDEX idx_pel_account_id ON program_execution_logs(account_id)"))
            conn.execute(text("CREATE INDEX idx_pel_program_id ON program_execution_logs(program_id)"))
            conn.execute(text("CREATE INDEX idx_pel_created_at ON program_execution_logs(created_at)"))
            conn.commit()
            print("✅ Created table: program_execution_logs")
        else:
            print("⏭️ Table program_execution_logs already exists, skipping")

    print("Migration completed: Program Trader tables created")


if __name__ == "__main__":
    upgrade()
