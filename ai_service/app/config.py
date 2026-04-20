from pathlib import Path

import dotenv
from pydantic_settings import BaseSettings

# Resolve .env relative to ai_service/ root (parent of app/)
_ENV_FILE = Path(__file__).resolve().parent.parent / ".env"

# Force-load .env with override so empty shell vars don't block it
dotenv.load_dotenv(str(_ENV_FILE), override=True)


class Settings(BaseSettings):
    anthropic_api_key: str = ""
    google_places_api_key: str = ""
    rails_api_url: str = "http://localhost:3000/api/v1"
    # 'tiny' ~75MB, 'base' ~500MB. Tiny fits Render free-tier 512MB RAM.
    whisper_model_size: str = "tiny"
    port: int = 8000
    service_api_key: str = ""
    log_level: str = "INFO"
    # WhatsApp Business API
    whatsapp_access_token: str = ""
    whatsapp_phone_number_id: str = ""
    whatsapp_verify_token: str = "mapass-webhook-verify"


settings = Settings()
