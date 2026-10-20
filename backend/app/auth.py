import asyncio
import base64
import hashlib
import hmac
import re
import secrets
import time
from urllib.parse import urlencode
import httpx
from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import RedirectResponse
from google.oauth2 import id_token
from google.auth.transport.requests import Request
from .config import settings
from .database import db, digest, new_session
from .models import Strict
from pydantic import Field

router = APIRouter(prefix="/auth")


def challenge(verifier: str):
    return base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()


def session(authorization: str | None = Header(default=None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Inicia sesión en la aplicación")
    with db() as conn:
        row = conn.execute("SELECT * FROM sessions WHERE token_hash=? AND expires>?", (digest(authorization[7:]), time.time())).fetchone()
    if not row: raise HTTPException(401, "La sesión de la aplicación caducó")
    return dict(row)


@router.post("/demo")
def demo():
    if not settings.enable_demo: raise HTTPException(403, "Demostración deshabilitada")
    return new_session("demo:" + secrets.token_urlsafe(16), "demo")


class Start(Strict):
    extension_id: str = Field(pattern=r"^[a-p]{32}$")
    handoff_challenge: str = Field(pattern=r"^[A-Za-z0-9_-]{43}$")
    client_state: str = Field(pattern=r"^[A-Za-z0-9_-]{43}$")


@router.post("/google/start")
def start(body: Start):
    if not settings.google_ready: raise HTTPException(503, "Configura el cliente OAuth de Google y el ID de la extensión en el backend")
    if body.extension_id not in settings.extension_ids: raise HTTPException(403, "Extensión no autorizada")
    state, nonce, verifier = [secrets.token_urlsafe(32) for _ in range(3)]
    with db() as conn:
        conn.execute("DELETE FROM oauth WHERE expires < ?", (time.time(),))
        conn.execute("INSERT INTO oauth VALUES(?,?,?,?,?,?,?)", (
            digest(state), body.extension_id, nonce, verifier, body.handoff_challenge, body.client_state, time.time() + 300))
    params = {
        "client_id": settings.google_client_id, "redirect_uri": settings.backend_public_url + "/auth/google/callback",
        "response_type": "code", "scope": "openid", "state": state, "nonce": nonce,
        "code_challenge": challenge(verifier), "code_challenge_method": "S256", "prompt": "select_account"
    }
    return {"authorization_url": "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(params)}


def verified_identity(encoded: str, nonce: str):
    claims = id_token.verify_oauth2_token(encoded, Request(), settings.google_client_id)
    if claims.get("iss") not in ("accounts.google.com", "https://accounts.google.com"):
        raise ValueError("Emisor incorrecto")
    if claims.get("aud") != settings.google_client_id or claims.get("exp", 0) <= time.time():
        raise ValueError("Audiencia o caducidad incorrecta")
    if not hmac.compare_digest(str(claims.get("nonce", "")), nonce) or not claims.get("sub"):
        raise ValueError("Nonce o identidad incorrectos")
    return "google:" + claims["sub"]


@router.get("/google/callback")
async def callback(state: str = "", code: str = "", error: str = ""):
    if not state or len(state) > 100 or len(code) > 4096: raise HTTPException(400, "Respuesta OAuth inválida")
    with db() as conn:
        row = conn.execute("DELETE FROM oauth WHERE state_hash=? AND expires>? RETURNING *", (digest(state), time.time())).fetchone()
    if not row or error or not code: raise HTTPException(400, "La autorización fue cancelada, caducó o no es válida")
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post("https://oauth2.googleapis.com/token", data={
                "client_id": settings.google_client_id, "client_secret": settings.google_client_secret,
                "code": code, "code_verifier": row["verifier"], "grant_type": "authorization_code",
                "redirect_uri": settings.backend_public_url + "/auth/google/callback"
            })
            response.raise_for_status()
            subject = await asyncio.to_thread(verified_identity, response.json()["id_token"], row["nonce"])
    except Exception:
        raise HTTPException(401, "No se pudo validar la identidad de Google") from None
    handoff = secrets.token_urlsafe(32)
    with db() as conn:
        conn.execute("DELETE FROM handoffs WHERE expires < ?", (time.time(),))
        conn.execute("INSERT INTO handoffs VALUES(?,?,?,?,?)", (digest(handoff), row["extension_id"], row["handoff_challenge"], subject, time.time() + 60))
    # Código de un solo uso ligado a PKCE; nunca se incluye una sesión en la URL.
    fragment = urlencode({"code": handoff, "state": row["client_state"]})
    return RedirectResponse(f"https://{row['extension_id']}.chromiumapp.org/oauth#{fragment}", headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"})


class Complete(Strict):
    code: str = Field(min_length=43, max_length=43)
    verifier: str = Field(pattern=r"^[A-Za-z0-9_-]{43}$")
    extension_id: str = Field(pattern=r"^[a-p]{32}$")


@router.post("/google/complete")
def complete(body: Complete):
    with db() as conn:
        row = conn.execute("SELECT * FROM handoffs WHERE code_hash=? AND expires>?", (digest(body.code), time.time())).fetchone()
        if not row or row["extension_id"] != body.extension_id or not hmac.compare_digest(row["challenge"], challenge(body.verifier)):
            raise HTTPException(401, "Vinculación inválida o caducada")
        deleted = conn.execute("DELETE FROM handoffs WHERE code_hash=?", (digest(body.code),)).rowcount
        if deleted != 1: raise HTTPException(401, "Código ya utilizado")
    return new_session(row["subject"], "google")


@router.get("/session")
def whoami(user=Depends(session)):
    return {"mode": user["mode"]}


@router.post("/logout")
def logout(user=Depends(session)):
    with db() as conn: conn.execute("DELETE FROM sessions WHERE token_hash=?", (user["token_hash"],))
    return {"ok": True}


@router.delete("/link")
def unlink(user=Depends(session)):
    with db() as conn: conn.execute("DELETE FROM sessions WHERE subject=?", (user["subject"],))
    return {"ok": True}
