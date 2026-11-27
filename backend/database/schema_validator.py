#!/usr/bin/env python3
"""
Database Schema Validator

Compares ORM models with actual database schema and auto-fixes discrepancies.
NEVER blocks application startup - only logs errors.
"""
import logging
from typing import Dict, List, Any, Optional
from sqlalchemy import text, inspect, Integer, BigInteger, String, Text, Float, DECIMAL, TIMESTAMP
from sqlalchemy.orm import DeclarativeMeta

from .connection import SessionLocal, engine, Base

logger = logging.getLogger(__name__)

# SQLAlchemy type to PostgreSQL type mapping
TYPE_COMPATIBILITY = {
    'Integer': ['integer', 'int4', 'serial'],
    'BigInteger': ['bigint', 'int8', 'bigserial'],
    'String': ['character varying', 'varchar', 'text'],
    'Text': ['text', 'jsonb', 'json', 'character varying'],
    'Float': ['double precision', 'float8', 'real', 'float4'],
    'DECIMAL': ['numeric', 'decimal'],
    'TIMESTAMP': ['timestamp without time zone', 'timestamp', 'timestamptz'],
    'Date': ['date'],
    'DateTime': ['timestamp without time zone', 'timestamp'],
    'Boolean': ['boolean', 'bool'],
}


def get_sqlalchemy_type_name(col_type) -> str:
    """Extract type name from SQLAlchemy column type"""
    type_name = type(col_type).__name__
    if type_name == 'Numeric':
        return 'DECIMAL'
    return type_name


def is_type_compatible(orm_type_name: str, db_type: str) -> bool:
    """Check if ORM type is compatible with database type"""
    db_type_lower = db_type.lower()
    compatible_types = TYPE_COMPATIBILITY.get(orm_type_name, [])
    return any(ct in db_type_lower for ct in compatible_types)


def get_postgres_type(col) -> str:
    """Convert SQLAlchemy column to PostgreSQL type string"""
    col_type = col.type
    type_name = type(col_type).__name__

    if type_name == 'String':
        length = getattr(col_type, 'length', None)
        return f"VARCHAR({length})" if length else "TEXT"
    elif type_name == 'Integer':
        return "INTEGER"
    elif type_name == 'BigInteger':
        return "BIGINT"
    elif type_name == 'Text':
        return "TEXT"
    elif type_name == 'Float':
        return "DOUBLE PRECISION"
    elif type_name in ('DECIMAL', 'Numeric'):
        precision = getattr(col_type, 'precision', 18)
        scale = getattr(col_type, 'scale', 6)
        return f"NUMERIC({precision},{scale})"
    elif type_name == 'TIMESTAMP':
        return "TIMESTAMP"
    elif type_name == 'Date':
        return "DATE"
    elif type_name == 'Boolean':
        return "BOOLEAN"
    else:
        return "TEXT"


def get_default_clause(col) -> str:
    """Get DEFAULT clause for column"""
    if col.default is not None:
        default_val = col.default.arg
        if isinstance(default_val, str):
            return f"DEFAULT '{default_val}'"
        elif isinstance(default_val, bool):
            return f"DEFAULT {'true' if default_val else 'false'}"
        elif default_val is not None:
            return f"DEFAULT {default_val}"
    if col.server_default is not None:
        return ""  # Server default handled by DB
    return ""


def get_db_columns(table_name: str) -> Dict[str, Dict[str, Any]]:
    """Get actual database columns for a table"""
    db = SessionLocal()
    try:
        result = db.execute(text("""
            SELECT column_name, data_type, is_nullable, column_default,
                   character_maximum_length, numeric_precision, numeric_scale
            FROM information_schema.columns
            WHERE table_name = :table_name
            ORDER BY ordinal_position
        """), {"table_name": table_name})

        columns = {}
        for row in result:
            columns[row[0]] = {
                'data_type': row[1],
                'nullable': row[2] == 'YES',
                'default': row[3],
                'max_length': row[4],
                'precision': row[5],
                'scale': row[6],
            }
        return columns
    finally:
        db.close()


def table_exists(table_name: str) -> bool:
    """Check if table exists in database"""
    db = SessionLocal()
    try:
        result = db.execute(text("""
            SELECT 1 FROM information_schema.tables
            WHERE table_name = :table_name AND table_schema = 'public'
        """), {"table_name": table_name})
        return result.fetchone() is not None
    finally:
        db.close()


def add_missing_column(table_name: str, col) -> bool:
    """Add a missing column to the database. Returns True if successful."""
    db = SessionLocal()
    try:
        pg_type = get_postgres_type(col)
        nullable = "NULL" if col.nullable else "NOT NULL"
        default_clause = get_default_clause(col)

        sql = f'ALTER TABLE {table_name} ADD COLUMN "{col.name}" {pg_type} {nullable} {default_clause}'
        sql = sql.strip()

        logger.info(f"Auto-fix: Executing: {sql}")
        db.execute(text(sql))
        db.commit()
        logger.info(f"Auto-fix SUCCESS: Added column {table_name}.{col.name}")
        return True
    except Exception as e:
        logger.error(f"Auto-fix FAILED for {table_name}.{col.name}: {e}")
        logger.error(f"Manual fix required: ALTER TABLE {table_name} ADD COLUMN {col.name} ...")
        db.rollback()
        return False
    finally:
        db.close()


def validate_table(model) -> Dict[str, Any]:
    """Validate a single table against its ORM model"""
    table_name = model.__tablename__
    result = {'table': table_name, 'missing': [], 'type_mismatch': [], 'fixed': [], 'errors': []}

    if not table_exists(table_name):
        result['errors'].append(f"Table {table_name} does not exist in database")
        return result

    db_columns = get_db_columns(table_name)
    orm_columns = {c.name: c for c in model.__table__.columns}

    for col_name, col in orm_columns.items():
        if col_name not in db_columns:
            result['missing'].append(col_name)
            if add_missing_column(table_name, col):
                result['fixed'].append(col_name)
            else:
                result['errors'].append(f"Failed to add column {col_name}")
        else:
            db_col = db_columns[col_name]
            orm_type_name = get_sqlalchemy_type_name(col.type)
            if not is_type_compatible(orm_type_name, db_col['data_type']):
                result['type_mismatch'].append({
                    'column': col_name,
                    'orm_type': orm_type_name,
                    'db_type': db_col['data_type']
                })

    return result


def get_all_orm_models() -> List:
    """Get all ORM models that inherit from Base"""
    # Import models to ensure they are registered with Base
    from . import models  # noqa: F401

    result = []
    for mapper in Base.registry.mappers:
        model = mapper.class_
        if hasattr(model, '__tablename__'):
            result.append(model)
    return result


def fix_raw_levels_column_type():
    """
    Fix raw_levels column type: jsonb -> text

    Background: Early migration script created column as JSONB,
    but ORM defines it as Text. This causes batch insert errors.
    Converting jsonb to text is lossless (JSON string).

    IDEMPOTENT: Only executes if column is jsonb, skips if already text.
    """
    db = SessionLocal()
    try:
        result = db.execute(text("""
            SELECT data_type FROM information_schema.columns
            WHERE table_name = 'market_orderbook_snapshots'
            AND column_name = 'raw_levels'
        """)).fetchone()

        if not result:
            return  # Table or column doesn't exist

        if result[0].lower() == 'jsonb':
            logger.info("[AutoFix] Fixing raw_levels column: jsonb -> text")
            db.execute(text(
                "ALTER TABLE market_orderbook_snapshots ALTER COLUMN raw_levels TYPE TEXT"
            ))
            db.commit()
            logger.info("[AutoFix] Fixed raw_levels column type successfully")
    except Exception as e:
        logger.error(f"[AutoFix] Failed to fix raw_levels column type: {e}")
        db.rollback()
    finally:
        db.close()


def validate_and_sync_schema() -> bool:
    """
    Main entry point: Compare ORM models with database schema and auto-fix.

    IMPORTANT: This function NEVER raises exceptions and NEVER blocks startup.
    All errors are logged but the function always returns True.
    """
    # Fix known type mismatch issues first
    fix_raw_levels_column_type()

    logger.info("=" * 60)
    logger.info("Schema Validator: Starting ORM vs Database comparison...")
    logger.info("=" * 60)

    total_missing = 0
    total_fixed = 0
    total_errors = 0
    total_type_mismatch = 0

    try:
        models = get_all_orm_models()
        logger.info(f"Found {len(models)} ORM models to validate")

        for model in models:
            try:
                result = validate_table(model)
                table_name = result['table']

                if result['missing']:
                    total_missing += len(result['missing'])
                    logger.warning(f"[{table_name}] Missing columns: {result['missing']}")

                if result['fixed']:
                    total_fixed += len(result['fixed'])
                    logger.info(f"[{table_name}] Auto-fixed columns: {result['fixed']}")

                if result['errors']:
                    total_errors += len(result['errors'])
                    for err in result['errors']:
                        logger.error(f"[{table_name}] {err}")

                if result['type_mismatch']:
                    total_type_mismatch += len(result['type_mismatch'])
                    for tm in result['type_mismatch']:
                        logger.warning(
                            f"[{table_name}] Type mismatch: {tm['column']} "
                            f"(ORM: {tm['orm_type']}, DB: {tm['db_type']})"
                        )

            except Exception as e:
                logger.error(f"Error validating model {model.__name__}: {e}")
                total_errors += 1

    except Exception as e:
        logger.error(f"Schema validation failed with unexpected error: {e}")

    # Summary
    logger.info("=" * 60)
    logger.info(f"Schema Validator Summary:")
    logger.info(f"  - Missing columns found: {total_missing}")
    logger.info(f"  - Columns auto-fixed: {total_fixed}")
    logger.info(f"  - Type mismatches (warning only): {total_type_mismatch}")
    logger.info(f"  - Errors (manual fix required): {total_errors}")
    logger.info("=" * 60)

    # NEVER block startup
    return True


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    validate_and_sync_schema()
