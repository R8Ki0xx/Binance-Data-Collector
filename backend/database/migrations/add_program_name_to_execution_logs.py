"""
Migration: Add program_name to program_execution_logs and make program_id nullable

This allows deleting programs while preserving execution logs with program name.
When a program is deleted, program_id will be set to NULL,
but program_name remains for historical display.
"""

from sqlalchemy import text


def run_migration(engine):
    """Add program_name column, make program_id nullable, and update FK constraints."""

    with engine.connect() as conn:
        # Step 1: Add program_name column if not exists
        result = conn.execute(text("""
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = 'program_execution_logs'
            AND column_name = 'program_name'
        """))

        if not result.fetchone():
            conn.execute(text("""
                ALTER TABLE program_execution_logs
                ADD COLUMN program_name VARCHAR(200)
            """))
            conn.commit()
            print("✅ Added program_name column to program_execution_logs")
        else:
            print("⏭️ program_name column already exists, skipping")

        # Step 2: Make program_id nullable if not already
        result = conn.execute(text("""
            SELECT is_nullable
            FROM information_schema.columns
            WHERE table_name = 'program_execution_logs'
            AND column_name = 'program_id'
        """))
        row = result.fetchone()

        if row and row[0] == 'NO':
            conn.execute(text("""
                ALTER TABLE program_execution_logs
                ALTER COLUMN program_id DROP NOT NULL
            """))
            conn.commit()
            print("✅ Made program_execution_logs.program_id nullable")
        else:
            print("⏭️ program_id is already nullable, skipping")

        # Step 3: Update program_id FK to ON DELETE SET NULL
        result = conn.execute(text("""
            SELECT confdeltype
            FROM pg_constraint
            WHERE conname = 'program_execution_logs_program_id_fkey'
        """))
        row = result.fetchone()

        if row and row[0] != 'n':  # 'n' = SET NULL
            conn.execute(text("""
                ALTER TABLE program_execution_logs
                DROP CONSTRAINT IF EXISTS program_execution_logs_program_id_fkey
            """))
            conn.execute(text("""
                ALTER TABLE program_execution_logs
                ADD CONSTRAINT program_execution_logs_program_id_fkey
                FOREIGN KEY (program_id) REFERENCES trading_programs(id) ON DELETE SET NULL
            """))
            conn.commit()
            print("✅ Updated program_id FK to ON DELETE SET NULL")
        else:
            print("⏭️ program_id FK already has ON DELETE SET NULL, skipping")

        # Step 4: Update binding_id FK to ON DELETE SET NULL
        result = conn.execute(text("""
            SELECT confdeltype
            FROM pg_constraint
            WHERE conname = 'program_execution_logs_binding_id_fkey'
        """))
        row = result.fetchone()

        if row and row[0] != 'n':  # 'n' = SET NULL
            conn.execute(text("""
                ALTER TABLE program_execution_logs
                DROP CONSTRAINT IF EXISTS program_execution_logs_binding_id_fkey
            """))
            conn.execute(text("""
                ALTER TABLE program_execution_logs
                ADD CONSTRAINT program_execution_logs_binding_id_fkey
                FOREIGN KEY (binding_id) REFERENCES account_program_bindings(id) ON DELETE SET NULL
            """))
            conn.commit()
            print("✅ Updated binding_id FK to ON DELETE SET NULL")
        else:
            print("⏭️ binding_id FK already has ON DELETE SET NULL, skipping")


if __name__ == "__main__":
    import sys
    sys.path.insert(0, "/home/wwwroot/hyper-alpha-arena-prod/backend")
    from database.connection import engine
    run_migration(engine)
