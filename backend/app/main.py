import asyncio
from contextlib import asynccontextmanager
import time
from uuid import UUID
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from .auth import router, session
from .config import settings
from .database import db, initialize
from .engine import Unsupported, bounded_solve
from .models import SolveRequest, Solution
from .providers import interpreter
from .local_assistant import AssistRequest, AssistResult, consult_local, local_status, create_job,job_state,cancel_job,close_jobs


@asynccontextmanager
async def lifespan(app):
    initialize()
    try: yield
    finally: await close_jobs()


app = FastAPI(title="Asistente matemático — MVP", lifespan=lifespan)
BACKEND_VERSION = "0.4.1"
app.add_middleware(CORSMiddleware,
    allow_origins=["http://127.0.0.1:8000"] + [f"chrome-extension://{v}" for v in settings.extension_ids],
    allow_methods=["GET", "POST", "DELETE"], allow_headers=["Authorization", "Content-Type"])


@app.middleware("http")
async def boundary(request: Request, call_next):
    from fastapi.responses import JSONResponse
    # Evita DNS rebinding y peticiones desde páginas ajenas, también sin preflight.
    if request.headers.get("host") not in ("127.0.0.1:8000", "testserver"):
        return JSONResponse({"detail": "Host no permitido"}, status_code=403)
    origin = request.headers.get("origin")
    allowed = ["http://127.0.0.1:8000"] + [f"chrome-extension://{v}" for v in settings.extension_ids]
    if origin and origin not in allowed:
        return JSONResponse({"detail": "Origen no autorizado"}, status_code=403)
    length = request.headers.get("content-length", "0")
    limit = 1_600_000 if request.url.path in ("/assist", "/assist/jobs") else 16000
    if not length.isdecimal() or int(length) > limit:
        return JSONResponse({"detail": "Petición demasiado grande"}, status_code=413)
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    if request.url.path.startswith("/simulator"):
        response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'"
    return response


app.include_router(router)


@app.get("/health")
def health():
    return {"status": "ok", "version": BACKEND_VERSION, "engine": "sympy", "google_configured": settings.google_ready,
            "ai_configured": settings.ai_ready or settings.local_ai_ready, "ai_provider": settings.ai_provider,
            "aleks_validated": False, "demo_enabled": settings.enable_demo}


@app.get("/ai/local/status")
async def ai_local_status(user=Depends(session)):
    return await local_status()


@app.post("/assist", response_model=AssistResult)
async def assist(body: AssistRequest, user=Depends(session)):
    if not settings.local_ai_ready:
        raise HTTPException(503, "Configura AI_PROVIDER=ollama y AI_MODEL en .env; reinicia el backend")
    try:
        return await consult_local(body)
    except Exception:
        raise HTTPException(502, "Ollama no respondió con una propuesta válida. Comprueba el servicio, el modelo instalado y su soporte de imágenes/JSON.") from None


@app.post("/assist/jobs", status_code=202)
async def start_assist_job(body: AssistRequest, user=Depends(session)):
    if not settings.local_ai_ready:
        raise HTTPException(503, "Configura AI_PROVIDER=ollama y AI_MODEL en .env; reinicia el backend")
    try: key = create_job(user["token_hash"], body)
    except ValueError as error: raise HTTPException(429, str(error)) from None
    return {"id": key}


@app.get("/assist/jobs/{job_id}")
async def get_assist_job(job_id: UUID, user=Depends(session)):
    result = job_state(user["token_hash"], str(job_id))
    if result is None: raise HTTPException(404, "Consulta no disponible")
    return result


@app.delete("/assist/jobs/{job_id}")
async def delete_assist_job(job_id: UUID, user=Depends(session)):
    cancel_job(user["token_hash"], str(job_id))
    return {"ok": True}


@app.post("/solve", response_model=Solution)
async def solve(body: SolveRequest, user=Depends(session)):
    exercise = body.exercise
    if exercise.source != "simulator":
        raise HTTPException(409, "Integración ALEKS pendiente de evidencia y validación; no se habilitan envíos reales")
    if exercise.ambiguities: raise HTTPException(422, "Lectura ambigua; revisa el ejercicio")
    if exercise.math is None:
        if not body.allow_ai or not settings.ai_ready: raise HTTPException(422, "Falta interpretación verificable; IA no disponible o límite agotado")
        try:
            proposal = await interpreter().interpret(exercise)
            interpreted = exercise.model_copy(update={"math": proposal.math})
            result = await asyncio.to_thread(bounded_solve, interpreted)
        except Exception:
            raise HTTPException(422, "La interpretación de IA no se pudo verificar") from None
        # Equivalencia matemática no demuestra que la IA interpretó bien el texto.
        # Sin evidencia estructurada independiente nunca autorizamos el envío automático.
        return result.model_copy(update={"status": "unverifiable", "provider": "openai", "proposed_by_ai": True,
                                         "provider_calls": 1, "explanation": "Propuesta de IA calculada; interpretación del texto pendiente de verificación independiente. " + result.explanation})
    try: result = await asyncio.to_thread(bounded_solve, exercise)
    except Unsupported as e: raise HTTPException(422, str(e)) from None
    with db() as conn:
        conn.execute("DELETE FROM history WHERE created < ?", (time.time() - 7 * 86400,))
        conn.execute("INSERT INTO history(subject,family,fingerprint,outcome,created) VALUES(?,?,?,?,?)",
                     (user["subject"], exercise.math.family, exercise.fingerprint, "verified", time.time()))
    return result


@app.get("/history")
def history(user=Depends(session)):
    with db() as conn:
        conn.execute("DELETE FROM history WHERE created < ?", (time.time() - 7 * 86400,))
        rows = conn.execute("SELECT family,fingerprint,outcome,created FROM history WHERE subject=? ORDER BY id DESC LIMIT 100", (user["subject"],)).fetchall()
    return [dict(r) for r in rows]


@app.delete("/history")
def clear_history(user=Depends(session)):
    with db() as conn: conn.execute("DELETE FROM history WHERE subject=?", (user["subject"],))
    return {"ok": True}


from .simulator import router as simulator_router
app.include_router(simulator_router)
app.mount("/simulator", StaticFiles(directory=Path(__file__).parents[1] / "simulator", html=True), name="simulator")
