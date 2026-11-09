from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field
from urllib.parse import urlsplit


def normalize_web_origin(value: str) -> str:
    parsed = urlsplit(value.strip())
    if (parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username
            or parsed.password or parsed.path not in ("", "/") or parsed.query or parsed.fragment):
        raise ValueError("WEB_PUBLIC_URL debe ser un origen HTTP(S), sin ruta ni credenciales")
    port = parsed.port
    host = parsed.hostname.lower()
    if ":" in host:
        host = f"[{host}]"
    if port and port != (443 if parsed.scheme == "https" else 80):
        host += f":{port}"
    return f"{parsed.scheme}://{host}"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    database_path: str = ".runtime/assistant.sqlite3"
    backend_public_url: str = "http://127.0.0.1:8000"
    # Lista separada por comas. No se permite el comodín *.
    chrome_extension_ids: str = ""
    google_client_id: str = ""
    google_client_secret: str = ""
    ai_provider: str = "none"
    ai_model: str = ""
    ai_timeout_seconds: int = Field(default=120, ge=10, le=600)
    ai_context_tokens: int = Field(default=8192, ge=2048, le=16384)
    openai_api_key: str = ""
    enable_demo: bool = True
    web_public_mode: bool = False
    web_public_url: str = "http://127.0.0.1:8000"
    web_database_url: str = ""
    web_account_daily_calls: int = Field(default=10, ge=0, le=10000)
    web_global_daily_calls: int = Field(default=100, ge=0, le=100000)
    gemini_api_key: str = ""
    gemini_model: str = ""
    web_ai_timeout_seconds: int = Field(default=60, ge=5, le=180)

    @property
    def web_origin(self):
        return normalize_web_origin(self.web_public_url)

    @property
    def extension_ids(self):
        return [v.strip() for v in self.chrome_extension_ids.split(",") if v.strip()]

    @property
    def google_ready(self):
        return bool(self.google_client_id and self.google_client_secret and self.extension_ids)

    @property
    def ai_ready(self):
        return self.ai_provider == "openai" and bool(self.ai_model and self.openai_api_key)

    @property
    def local_ai_ready(self):
        return self.ai_provider == "ollama" and bool(self.ai_model)


settings = Settings()
