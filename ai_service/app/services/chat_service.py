"""Conversational assistant for trip refinement."""

from __future__ import annotations

import asyncio
import logging

import anthropic

from app.api.schemas import ChatMessage
from app.config import settings
from app.services.rails_client import RailsClient

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """Você é o assistente de viagem do Mapass. Ajuda o usuário a planejar,
ajustar e aprimorar o roteiro dele.

Regras:
- Responda em português do Brasil, de forma calorosa e concisa (2-4 frases).
- Seja específico: mencione lugares reais, não genéricos.
- Se o usuário pedir mudança no roteiro, confirme o que entendeu e sugira próximos passos.
- Quando não souber algo sobre o roteiro atual, pergunte antes de chutar.
- Emojis sutis (✨ 📍 🍽️ 🏛️) ajudam — mas não exagere.
"""


async def _build_trip_context(trip_id: int | None) -> str:
    if not trip_id:
        return ""
    try:
        rails = RailsClient()
        trip = await rails.get_trip(trip_id)
        if not trip:
            return ""
        lines = [
            f"Roteiro atual do usuário:",
            f"- Destino: {trip.get('destination')}",
            f"- Dias: {trip.get('num_days')}",
            f"- Título: {trip.get('title')}",
        ]
        days = trip.get("day_plans", []) or []
        for day in days[:10]:
            lines.append(f"\nDia {day.get('day_number')}:")
            items = day.get("items", []) or []
            for it in items[:8]:
                time = (it.get("start_time") or "")[:5]
                lines.append(f"  - {time} {it.get('title')}")
        return "\n".join(lines)
    except Exception as e:
        logger.warning("[chat] Failed to load trip context: %s", e)
        return ""


async def chat_reply(
    message: str,
    history: list[ChatMessage],
    trip_id: int | None = None,
) -> str:
    """Get a chat reply from Haiku with optional trip context."""
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    context = await _build_trip_context(trip_id)
    system = SYSTEM_PROMPT
    if context:
        system += f"\n\n{context}"

    messages: list[dict] = []
    for m in history[-10:]:
        if m.role in ("user", "assistant") and m.content:
            messages.append({"role": m.role, "content": m.content})
    messages.append({"role": "user", "content": message})

    try:
        response = await asyncio.to_thread(
            lambda: client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=600,
                system=system,
                messages=messages,
            )
        )
        if response.content and response.content[0].text:
            return response.content[0].text.strip()
        return "Hmm, não consegui responder agora. Tenta de novo?"
    except Exception as e:
        logger.exception("[chat] Claude call failed")
        raise
