from functools import lru_cache
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql://taskman:taskman@localhost:5432/taskman"
    jwt_secret: str = "change-this-secret-in-production"
    access_token_expire_minutes: int = 10080
    cors_origins: str = "https://taskman.fnetrix.com,https://www.taskman.fnetrix.com,http://localhost:3000,http://localhost:5173,http://127.0.0.1:3000,http://127.0.0.1:5173"
    cors_origin_regex: str = r"https?://([a-z0-9-]+\.)?fnetrix\.com(:\d+)?|https?://localhost(:\d+)?|https?://127\.0\.0\.1(:\d+)?"
    github_webhook_secret: str = ""
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


@lru_cache
def get_settings() -> Settings:
    return Settings()
