"""Cuenta y cuotas persistentes: SQLite local, PostgreSQL en despliegues públicos."""
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from .config import settings


def postgres():
    return settings.web_database_url.startswith(("postgresql://", "postgres://"))


class Connection:
    def __init__(self, connection, is_postgres):
        self.connection = connection
        self.is_postgres = is_postgres

    def execute(self, sql, parameters=()):
        return self.connection.execute(sql.replace("?", "%s") if self.is_postgres else sql, parameters)


@contextmanager
def web_db():
    is_postgres = postgres()
    if is_postgres:
        import psycopg
        from psycopg.rows import dict_row
        trust = {}
        if settings.web_public_mode and "sslrootcert" not in parse_qs(urlsplit(settings.web_database_url).query):
            trust["sslrootcert"] = "system"
        connection = psycopg.connect(settings.web_database_url, row_factory=dict_row, connect_timeout=10, **trust)
    else:
        url = settings.web_database_url
        if url and not url.startswith("sqlite:///"):
            raise ValueError("WEB_DATABASE_URL no admitida")
        path = url[len("sqlite:///"):] if url else settings.database_path + ".web.sqlite3"
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(path, timeout=15)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("BEGIN IMMEDIATE")
    try:
        yield Connection(connection, is_postgres)
        connection.commit()
    except BaseException:
        connection.rollback()
        raise
    finally:
        connection.close()


def initialize_web():
    origin = settings.web_origin
    if settings.web_public_mode and (not origin.startswith("https://") or not postgres()):
        raise ValueError("El modo público requiere WEB_PUBLIC_URL HTTPS y WEB_DATABASE_URL PostgreSQL persistente")
    if settings.web_public_mode and parse_qs(urlsplit(settings.web_database_url).query).get("sslmode") != ["verify-full"]:
        raise ValueError("WEB_DATABASE_URL público requiere sslmode=verify-full para verificar el servidor PostgreSQL")
    with web_db() as conn:
        for sql in (
            "CREATE TABLE IF NOT EXISTS web_users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created DOUBLE PRECISION NOT NULL)",
            "CREATE TABLE IF NOT EXISTS web_sessions (id TEXT PRIMARY KEY, user_id TEXT REFERENCES web_users(id) ON DELETE CASCADE, csrf TEXT NOT NULL, expires DOUBLE PRECISION NOT NULL)",
            "CREATE INDEX IF NOT EXISTS web_sessions_user ON web_sessions(user_id)",
            "CREATE TABLE IF NOT EXISTS web_bridge_tokens (token_hash TEXT PRIMARY KEY, session_id TEXT NOT NULL UNIQUE REFERENCES web_sessions(id) ON DELETE CASCADE, expires DOUBLE PRECISION NOT NULL)",
            "CREATE TABLE IF NOT EXISTS web_throttle (bucket TEXT NOT NULL, window_start BIGINT NOT NULL, used INTEGER NOT NULL, PRIMARY KEY(bucket,window_start))",
            "CREATE TABLE IF NOT EXISTS web_quota (day TEXT NOT NULL, owner TEXT NOT NULL, used INTEGER NOT NULL, PRIMARY KEY(day,owner))",
        ):
            conn.execute(sql)
