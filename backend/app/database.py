import hashlib
import secrets
import sqlite3
import time
from pathlib import Path
from contextlib import contextmanager
from .config import settings


def digest(value: str):
    return hashlib.sha256(value.encode()).hexdigest()


@contextmanager
def db():
    Path(settings.database_path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(settings.database_path, timeout=10)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def initialize():
    with db() as conn:
        conn.executescript("""
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS sessions (
          token_hash TEXT PRIMARY KEY, subject TEXT NOT NULL, mode TEXT NOT NULL, expires REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS oauth (
          state_hash TEXT PRIMARY KEY, extension_id TEXT, nonce TEXT, verifier TEXT,
          handoff_challenge TEXT, client_state TEXT, expires REAL);
        CREATE TABLE IF NOT EXISTS handoffs (
          code_hash TEXT PRIMARY KEY, extension_id TEXT, challenge TEXT, subject TEXT, expires REAL);
        CREATE TABLE IF NOT EXISTS history (
          id INTEGER PRIMARY KEY, subject TEXT, family TEXT, fingerprint TEXT, outcome TEXT, created REAL);
        CREATE TABLE IF NOT EXISTS grades (
          operation TEXT PRIMARY KEY, problem TEXT, answer TEXT, accepted INTEGER, created REAL);
        """)
        now = time.time()
        for table in ("sessions", "oauth", "handoffs"):
            conn.execute(f"DELETE FROM {table} WHERE expires < ?", (now,))
        conn.execute("DELETE FROM history WHERE created < ?", (now - 7 * 86400,))
        conn.execute("DELETE FROM grades WHERE created < ?", (now - 86400,))


def new_session(subject: str, mode: str):
    token = secrets.token_urlsafe(32)
    with db() as conn:
        conn.execute("DELETE FROM sessions WHERE expires < ?", (time.time(),))
        conn.execute("INSERT INTO sessions VALUES(?,?,?,?)", (digest(token), subject, mode, time.time() + 8 * 3600))
    return {"token": token, "mode": mode, "expires_in": 8 * 3600}
