"""Capacidad temporal para consultas desde la extensión, sin acceso a cuentas."""
import secrets
import time
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import Field

from . import web_ai
from .config import settings
from .local_assistant import AssistRequest
from .models import Strict
from .web_accounts import current_user, digest, require_csrf
from .web_store import web_db

router = APIRouter(prefix="/web-api", tags=["extension-bridge"])
BRIDGE_SECONDS = 3600


class RevokeCapability(Strict):
    capability_id: str = Field(pattern=r"^[a-f0-9]{64}$")


async def cleanup_capability(user, token_id):
    for key, job in list(web_ai.jobs.items()):
        if job.session_id == user["session_id"] and job.bridge_token_id == token_id:
            await web_ai.delete_job(UUID(key), {**user, "bridge_token_id": token_id})


def bridge_origin():
    return "chrome-extension://" + settings.web_bridge_extension_id


def _capability(token_hash):
    now = time.time()
    with web_db() as conn:
        row = conn.execute(
            "SELECT u.id,u.email,s.id AS session_id,b.expires FROM web_bridge_tokens b "
            "JOIN web_sessions s ON s.id=b.session_id JOIN web_users u ON u.id=s.user_id "
            "WHERE b.token_hash=? AND b.expires>? AND s.expires>?",
            (token_hash, now, now),
        ).fetchone()
    return dict(row) if row else None


def bridge_active(token_hash):
    return _capability(token_hash) is not None


def bridge_user(request: Request):
    origin = request.headers.get("origin")
    # Con permisos de host, Chrome puede omitir Origin en peticiones del worker.
    # En ese caso se exige igualmente la capacidad; nunca se usan las cookies.
    if origin is not None and origin != bridge_origin():
        raise HTTPException(403, "Origen de extensión no autorizado")
    authorization = request.headers.get("authorization", "")
    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer" or len(parts[1]) != 43:
        raise HTTPException(401, "Vincula de nuevo la extensión desde tu cuenta web")
    token_hash = digest(parts[1])
    capability = _capability(token_hash)
    if not capability:
        raise HTTPException(401, "La vinculación venció o fue revocada; vuelve a vincular la extensión")
    return {**capability, "bridge_token_id": token_hash}


@router.post("/bridge-token", status_code=201, dependencies=[Depends(require_csrf)])
async def issue_bridge_token(user=Depends(current_user)):
    now = time.time()
    token = secrets.token_urlsafe(32)
    token_id = digest(token)
    with web_db() as conn:
        session = conn.execute("SELECT expires FROM web_sessions WHERE id=? AND user_id=? AND expires>?", (user["session_id"], user["id"], now)).fetchone()
        if not session:
            raise HTTPException(401, "La sesión venció; vuelve a iniciar sesión")
        expires = min(now + BRIDGE_SECONDS, session["expires"])
        previous = conn.execute("SELECT token_hash FROM web_bridge_tokens WHERE session_id=?", (user["session_id"],)).fetchall()
        conn.execute("DELETE FROM web_bridge_tokens WHERE expires<=? OR session_id=?", (now, user["session_id"]))
        conn.execute("INSERT INTO web_bridge_tokens(token_hash,session_id,expires) VALUES(?,?,?)", (token_id, user["session_id"], expires))
    for old in previous:
        await cleanup_capability(user, old["token_hash"])
    return {"token": token, "capability_id": token_id, "expires_in": max(0, int(expires - now)), "expires_at": expires,
            "user": {"id": user["id"], "email": user["email"]}}


@router.delete("/bridge-token", status_code=204, dependencies=[Depends(require_csrf)])
async def revoke_bridge_token(body: RevokeCapability, user=Depends(current_user)):
    with web_db() as conn:
        conn.execute("DELETE FROM web_bridge_tokens WHERE session_id=? AND token_hash=?", (user["session_id"], body.capability_id))
    await cleanup_capability(user, body.capability_id)
    return Response(status_code=204)


@router.get("/bridge/session")
async def get_bridge_session(user=Depends(bridge_user)):
    return {"user": {"id": user["id"], "email": user["email"]}, "expires_at": user["expires"]}


@router.post("/bridge/jobs", status_code=202)
async def create_bridge_job(body: AssistRequest, user=Depends(bridge_user)):
    return await web_ai.create_job(body, user)


@router.get("/bridge/jobs/{key}")
async def get_bridge_job(key: UUID, user=Depends(bridge_user)):
    return await web_ai.get_job(key, user)


@router.delete("/bridge/jobs/{key}", status_code=204)
async def delete_bridge_job(key: UUID, user=Depends(bridge_user)):
    return await web_ai.delete_job(key, user)


@router.delete("/bridge/jobs", status_code=204)
async def delete_bridge_jobs(user=Depends(bridge_user)):
    await cleanup_capability(user, user["bridge_token_id"])
    return Response(status_code=204)
