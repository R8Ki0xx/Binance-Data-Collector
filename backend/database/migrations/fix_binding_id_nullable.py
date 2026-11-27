"""
Migration: Make program_execution_logs.binding_id nullable

This allows deleting program bindings while preserving execution logs.
When a binding is deleted, the binding_id will be set to NULL,
but logs remain queryable via account_id and program_id.
"""

from sqlalchemy import text


def run_migration(engine):
    """Make binding_id column nullable in program_execution_logs table."""

    with engine.connect() as conn:
        # Check if column is already nullable
        result = conn.execute(text("""
            SELECT is_nullable
            FROM information_schema.columns
            WHERE table_name = 'program_execution_logs'
            AND column_name = 'binding_id'
        """))
        row = result.fetchone()

        if not row:
            print("⏭️ Column binding_id not found in program_execution_logs, skipping")
            return

        is_nullable = row[0]

        if is_nullable == 'YES':
            print("⏭️ binding_id is already nullable, skipping")
            return

        # Drop NOT NULL constraint
        conn.execute(text("""
            ALTER TABLE program_execution_logs
            ALTER COLUMN binding_id DROP NOT NULL
        """))
        conn.commit()

        print("✅ Made program_execution_logs.binding_id nullable")


if __name__ == "__main__":
    # For standalone testing
    import sys
    sys.path.insert(0, "/home/wwwroot/hyper-alpha-arena-prod/backend")
    from database.connection import engine
    run_migration(engine)
