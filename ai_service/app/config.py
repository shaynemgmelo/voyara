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
    # Whisper config kept for any local use (Pro agent tool); the extractor
    # pipeline uses Groq Whisper API instead (see GROQ_API_KEY).
    whisper_model_size: str = "tiny"
    groq_api_key: str = ""
    port: int = 8000
    service_api_key: str = ""
    log_level: str = "INFO"
    # WhatsApp Business API
    whatsapp_access_token: str = ""
    whatsapp_phone_number_id: str = ""
    whatsapp_verify_token: str = "mapass-webhook-verify"
    # Tavily web search — used for STEP 4 of the planning spec (external
    # itinerary research when destination is tour_driven or multi_base).
    # Optional: if unset, the research step is skipped gracefully and we
    # fall back to Sonnet's internal knowledge.
    tavily_api_key: str = ""


settings = Settings()
