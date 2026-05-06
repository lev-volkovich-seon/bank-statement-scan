from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    anthropic_api_key: str = ""
    google_api_key: str = ""
    api_bearer_token: str = "changeme"
    default_provider: str = "claude"
    prompt_version: str = "1.0.0"
    timeout_seconds: int = 15
    claude_model: str = "claude-sonnet-4-6"
    gemini_model: str = "gemini-2.0-flash"

    class Config:
        env_file = ".env"


@lru_cache
def get_settings() -> Settings:
    return Settings()
