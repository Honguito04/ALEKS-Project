from pydantic_settings import BaseSettings, SettingsConfigDict


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
    openai_api_key: str = ""
    enable_demo: bool = True

    @property
    def extension_ids(self):
        return [v.strip() for v in self.chrome_extension_ids.split(",") if v.strip()]

    @property
    def google_ready(self):
        return bool(self.google_client_id and self.google_client_secret and self.extension_ids)

    @property
    def ai_ready(self):
        return self.ai_provider == "openai" and bool(self.ai_model and self.openai_api_key)


settings = Settings()
