"""Cuentas web con cookies opacas, CSRF y límites persistentes."""
import hashlib
import hmac
import re
import secrets
import time
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator

from .config import settings
from .web_store import initialize_web, web_db

router = APIRouter(prefix="/web-api")
COOKIE = "assistant_web_session"
SESSION_SECONDS = 8 * 3600
_cleanup_callbacks = []


def register_cleanup(callback):
    if callback not in _cleanup_callbacks:
        _cleanup_callbacks.append(callback)


def _cleanup(user_id):
    for callback in _cleanup_callbacks:
        callback(user_id)


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def password_hash(password, salt=None):
    salt = salt or secrets.token_hex(16)
    result = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=32768, r=8, p=3, maxmem=64 * 1024 * 1024)
    return f"scrypt${salt}${result.hex()}"


def password_matches(password, saved):
    try:
        kind, salt, _ = saved.split("$")
        return kind == "scrypt" and hmac.compare_digest(password_hash(password, salt), saved)
    except (ValueError, TypeError):
        return False


_DUMMY_HASH = password_hash("dummy password for timing")


class Credentials(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=12, max_length=128)

    @field_validator("email")
    @classmethod
    def email_address(cls, value):
        value = value.strip().casefold()
        if not re.fullmatch(r"[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}", value):
            raise ValueError("Correo no válido")
        return value


class PasswordConfirmation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    password: str = Field(min_length=1, max_length=128)


def _session(request):
    token = request.cookies.get(COOKIE, "")
    if not token or len(token) > 100:
        return None
    with web_db() as conn:
        row = conn.execute("SELECT id,user_id,csrf,expires FROM web_sessions WHERE id=? AND expires>?", (digest(token), time.time())).fetchone()
    return dict(row) if row else None


def require_csrf(request: Request):
    if request.headers.get("origin") != settings.web_origin:
        raise HTTPException(403, "Origen no autorizado")
    session = _session(request)
    if request.url.path not in ("/web-api/register", "/web-api/login") and (not session or not session["user_id"]):
        raise HTTPException(401, "La sesión venció; vuelve a iniciar sesión")
    supplied = request.headers.get("x-csrf-token", "")
    if not session or not supplied or not hmac.compare_digest(supplied, session["csrf"]):
        raise HTTPException(403, "Solicitud caducada o no autorizada; actualiza la página")
    return session


def current_user(request: Request):
    session = _session(request)
    if not session or not session["user_id"]:
        raise HTTPException(401, "La sesión venció; vuelve a iniciar sesión")
    with web_db() as conn:
        row = conn.execute("SELECT id,email FROM web_users WHERE id=?", (session["user_id"],)).fetchone()
    if not row:
        raise HTTPException(401, "La sesión venció; vuelve a iniciar sesión")
    return {**dict(row), "session_id": session["id"]}


def session_active(session_id):
    with web_db() as conn:
        return conn.execute("SELECT id FROM web_sessions WHERE id=? AND user_id IS NOT NULL AND expires>?", (session_id, time.time())).fetchone() is not None


def _new_session(response, user_id=None, previous=None):
    token = secrets.token_urlsafe(32)
    csrf = secrets.token_urlsafe(32)
    now = time.time()
    with web_db() as conn:
        conn.execute("DELETE FROM web_sessions WHERE expires<=?", (now,))
        if previous:
            conn.execute("DELETE FROM web_sessions WHERE id=?", (previous,))
        conn.execute("INSERT INTO web_sessions(id,user_id,csrf,expires) VALUES(?,?,?,?)", (digest(token), user_id, csrf, now + SESSION_SECONDS))
    response.set_cookie(COOKIE, token, httponly=True, secure=settings.web_origin.startswith("https://"), samesite="strict", max_age=SESSION_SECONDS, path="/web-api")
    return csrf


def _throttle(buckets):
    now = time.time()
    blocked = False
    with web_db() as conn:
        conn.execute("DELETE FROM web_throttle WHERE window_start<?", (int(now) - 86400,))
        for key, seconds, limit in buckets:
            window = int(now) // seconds * seconds
            key = digest(key)
            row = conn.execute("INSERT INTO web_throttle(bucket,window_start,used) VALUES(?,?,1) ON CONFLICT(bucket,window_start) DO UPDATE SET used=web_throttle.used+1 RETURNING used", (key, window)).fetchone()
            blocked = blocked or row["used"] > limit
    if blocked:
        raise HTTPException(429, "Demasiados intentos; espera antes de volver a intentarlo", headers={"Retry-After": "900"})


def reserve_call(user_id):
    """Reserva antes de cada llamada, incluso revisiones; no devuelve cuota por fallos."""
    day = datetime.now(timezone.utc).date().isoformat()
    with web_db() as conn:
        if not conn.execute("SELECT id FROM web_users WHERE id=?", (user_id,)).fetchone():
            raise HTTPException(401, "La cuenta ya no está disponible")
        for owner in ("global", user_id):
            conn.execute("INSERT INTO web_quota(day,owner,used) VALUES(?,?,0) ON CONFLICT(day,owner) DO NOTHING", (day, owner))
        sql = "SELECT owner,used FROM web_quota WHERE day=? AND owner IN (?,?)"
        if conn.is_postgres:
            sql += " ORDER BY owner FOR UPDATE"
        usage = {row["owner"]: row["used"] for row in conn.execute(sql, (day, "global", user_id)).fetchall()}
        if usage[user_id] >= settings.web_account_daily_calls or usage["global"] >= settings.web_global_daily_calls:
            raise HTTPException(429, "Cuota diaria agotada; vuelve mañana (UTC). Las revisiones también consumen cuota.")
        conn.execute("UPDATE web_quota SET used=used+1 WHERE day=? AND owner IN (?,?)", (day, "global", user_id))


def _public_user(user):
    return {"id": user["id"], "email": user["email"]}


@router.get("/session")
def get_session(request: Request, response: Response):
    session = _session(request)
    if session:
        with web_db() as conn:
            user = conn.execute("SELECT id,email FROM web_users WHERE id=?", (session["user_id"],)).fetchone() if session["user_id"] else None
        return {"user": _public_user(user) if user else None, "csrf_token": session["csrf"]}
    client = request.client.host if request.client else "unknown"
    _throttle([(f"anonymous-session:{client}", 3600, 60)])
    return {"user": None, "csrf_token": _new_session(response)}


@router.post("/register", status_code=201)
async def register(body: Credentials, request: Request, response: Response, session=Depends(require_csrf)):
    client = request.client.host if request.client else "unknown"
    _throttle([(f"register:{client}", 3600, 10), (f"register-email:{body.email}", 3600, 3)])
    user = {"id": secrets.token_hex(16), "email": body.email}
    hashed = password_hash(body.password)
    with web_db() as conn:
        row = conn.execute("INSERT INTO web_users(id,email,password_hash,created) VALUES(?,?,?,?) ON CONFLICT(email) DO NOTHING RETURNING id", (user["id"], body.email, hashed, time.time())).fetchone()
        if not row:
            raise HTTPException(409, "No se pudo registrar ese correo; intenta iniciar sesión")
    return {"user": user, "csrf_token": _new_session(response, user["id"], session["id"])}


@router.post("/login")
async def login(body: Credentials, request: Request, response: Response, session=Depends(require_csrf)):
    client = request.client.host if request.client else "unknown"
    _throttle([(f"login:{client}", 3600, 100), (f"login-email:{body.email}", 900, 10)])
    with web_db() as conn:
        user = conn.execute("SELECT id,email,password_hash FROM web_users WHERE email=?", (body.email,)).fetchone()
    valid = password_matches(body.password, user["password_hash"] if user else _DUMMY_HASH)
    if not user or not valid:
        raise HTTPException(401, "Correo o contraseña incorrectos")
    return {"user": _public_user(user), "csrf_token": _new_session(response, user["id"], session["id"])}


@router.post("/logout", status_code=204)
async def logout(response: Response, user=Depends(current_user), _=Depends(require_csrf)):
    with web_db() as conn:
        conn.execute("DELETE FROM web_sessions WHERE user_id=?", (user["id"],))
    _cleanup(user["id"])
    response.delete_cookie(COOKIE, path="/web-api", httponly=True, samesite="strict", secure=settings.web_origin.startswith("https://"))


@router.delete("/account", status_code=204)
async def delete_account(body: PasswordConfirmation, request: Request, response: Response, user=Depends(current_user), _=Depends(require_csrf)):
    _throttle([(f"delete:{user['id']}", 900, 10)])
    with web_db() as conn:
        row = conn.execute("SELECT password_hash FROM web_users WHERE id=?", (user["id"],)).fetchone()
        if not row or not password_matches(body.password, row["password_hash"]):
            raise HTTPException(400, "Contraseña incorrecta; la cuenta no se eliminó")
        conn.execute("DELETE FROM web_users WHERE id=?", (user["id"],))
        conn.execute("DELETE FROM web_quota WHERE owner=?", (user["id"],))
    _cleanup(user["id"])
    response.delete_cookie(COOKIE, path="/web-api", httponly=True, samesite="strict", secure=settings.web_origin.startswith("https://"))
