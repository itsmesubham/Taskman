from functools import lru_cache
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql://taskman:taskman@localhost:5432/taskman"
    jwt_secret: str = "change-this-secret-in-production"
    access_token_expire_minutes: int = 10080
    event_stream_token_expire_minutes: int = 15
    github_app_id: str = ""
    github_app_client_id: str = ""
    github_app_client_secret: str = ""
    github_app_private_key: str = ""
    github_webhook_secret: str = ""
    github_state_secret: str = ""
    github_app_slug: str = "taskman-ai"
    public_app_url: str = "https://taskman.fnetrix.com"
    github_callback_url: str = "https://taskman.fnetrix.com/api/integrations/github/callback"
    github_setup_url: str = "https://taskman.fnetrix.com/api/integrations/github/setup"
    github_webhook_url: str = "https://taskman.fnetrix.com/api/webhooks/github"
    cors_origins: str = "https://taskman.fnetrix.com,https://www.taskman.fnetrix.com,http://localhost:3000,http://localhost:5173,http://127.0.0.1:3000,http://127.0.0.1:5173"
    cors_origin_regex: str = r"https?://([a-z0-9-]+\.)?fnetrix\.com(:\d+)?|https?://localhost(:\d+)?|https?://127\.0\.0\.1(:\d+)?"
    agent_claim_minutes: int = 60
    agent_rate_limit_per_minute: int = 60

    @property
    def cors_origin_list(self) -> list[str]:
        required = {
            "http://localhost:3000",
            "http://localhost:5173",
            "http://127.0.0.1:3000",
            "http://127.0.0.1:5173",
            "https://taskman.fnetrix.com",
            "https://www.taskman.fnetrix.com",
        }
        configured = {origin.strip() for origin in self.cors_origins.split(",") if origin.strip()}
        return sorted(required | configured)

    @property
    def github_private_key_pem(self) -> str:
        return self.github_app_private_key.replace("\\n", "\n").strip()


@lru_cache
def get_settings() -> Settings:
    return Settings()
