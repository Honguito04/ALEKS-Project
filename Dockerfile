# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS web
WORKDIR /build
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm ci --no-audit --no-fund
COPY web ./web
COPY vite.web.config.ts ./
RUN npx vite build --config vite.web.config.ts

FROM python:3.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
COPY backend/requirements.lock ./requirements.lock
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export PIP_CERT=/run/secrets/proxy_ca; fi; \
    pip install --no-cache-dir -r requirements.lock \
    && test -s /etc/ssl/certs/ca-certificates.crt \
    && useradd --create-home --uid 10001 assistant
COPY --chown=assistant:assistant backend ./backend
COPY --from=web --chown=assistant:assistant /build/web-dist ./web-dist
USER assistant
ENV WEB_PUBLIC_MODE=true
# Un único proceso: las consultas en curso viven en su memoria.
# Desactivar confianza en cabeceras reenviadas: ni Host ni X-Forwarded-For
# proporcionados por clientes deciden autorización o cuotas.
CMD ["sh", "-c", "exec python -m uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port ${PORT:-8000} --workers 1 --no-access-log --no-proxy-headers"]
