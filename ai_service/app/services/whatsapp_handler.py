"""WhatsApp conversation handler for Voyara.

Manages conversation state and processes messages through the itinerary pipeline.
Flow:
  1. User sends a TikTok/Instagram/YouTube link
  2. Bot asks for destination (if not detected from link)
  3. Bot asks for number of days
  4. Bot processes link → extracts content → generates itinerary
  5. Bot sends itinerary day by day
"""

from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime, timedelta

import anthropic

from app.config import settings
from app.services.whatsapp_client import WhatsAppClient
from app.services.orchestrator import _extract_content, _call_claude_for_itinerary, _build_itinerary_prompt
from app.ai.cost_tracker import CostTracker
from app.google_places.client import GooglePlacesClient

logger = logging.getLogger(__name__)

# In-memory conversation state (use Redis in production)
conversations: dict[str, dict] = {}

# URL pattern for supported links
URL_PATTERN = re.compile(
    r"https?://(?:www\.)?(?:tiktok\.com|instagram\.com|youtube\.com|youtu\.be|vm\.tiktok\.com)\S+"
)


def _detect_url(text: str) -> str | None:
    """Extract first supported URL from message text."""
    match = URL_PATTERN.search(text)
    return match.group(0) if match else None


def _get_conversation(phone: str) -> dict:
    """Get or create conversation state."""
    if phone not in conversations:
        conversations[phone] = {
            "state": "idle",
            "url": None,
            "destination": None,
            "days": None,
            "content_text": None,
            "last_activity": datetime.now(),
        }
    conv = conversations[phone]
    # Reset stale conversations (>30 min inactive)
    if (datetime.now() - conv["last_activity"]) > timedelta(minutes=30):
        conversations[phone] = {
            "state": "idle",
            "url": None,
            "destination": None,
            "days": None,
            "content_text": None,
            "last_activity": datetime.now(),
        }
    conv["last_activity"] = datetime.now()
    return conversations[phone]


async def handle_message(
    phone: str, text: str, message_id: str, wa: WhatsAppClient
) -> None:
    """Process an incoming WhatsApp message and respond."""
    await wa.mark_read(message_id)

    conv = _get_conversation(phone)
    text_lower = text.strip().lower()

    # Handle restart/menu commands
    if text_lower in ("oi", "ola", "olá", "menu", "inicio", "início", "hi", "hello", "start"):
        conv["state"] = "idle"
        await _send_welcome(phone, wa)
        return

    # State machine
    state = conv["state"]

    if state == "idle":
        url = _detect_url(text)
        if url:
            conv["url"] = url
            conv["state"] = "extracting"
            await wa.send_text(
                phone,
                "🔍 *Analisando seu link...*\nExtraindo lugares e informações do vídeo. Um momento!"
            )
            # Extract content in background
            asyncio.create_task(_extract_and_continue(phone, url, wa))
        else:
            # No link — ask for destination directly
            conv["state"] = "ask_destination"
            await wa.send_text(
                phone,
                "✈️ *Vamos montar seu roteiro!*\n\n"
                "Você pode:\n"
                "📎 Enviar um link de *TikTok, Instagram ou YouTube* com dicas de viagem\n"
                "📍 Ou me dizer direto o *destino* (ex: \"Paris\", \"Nova York\")"
            )
        return

    if state == "waiting_destination":
        conv["destination"] = text.strip()
        conv["state"] = "ask_days"
        await wa.send_buttons(
            phone,
            f"📍 Destino: *{conv['destination']}*\n\nQuantos dias vai ficar?",
            [
                {"id": "days_3", "title": "3 dias"},
                {"id": "days_5", "title": "5 dias"},
                {"id": "days_7", "title": "7 dias"},
            ],
        )
        return

    if state == "ask_destination":
        url = _detect_url(text)
        if url:
            conv["url"] = url
            conv["state"] = "extracting"
            await wa.send_text(
                phone,
                "🔍 *Analisando seu link...*\nExtraindo lugares e informações. Um momento!"
            )
            asyncio.create_task(_extract_and_continue(phone, url, wa))
        else:
            conv["destination"] = text.strip()
            conv["state"] = "ask_days"
            await wa.send_buttons(
                phone,
                f"📍 Destino: *{conv['destination']}*\n\nQuantos dias vai ficar?",
                [
                    {"id": "days_3", "title": "3 dias"},
                    {"id": "days_5", "title": "5 dias"},
                    {"id": "days_7", "title": "7 dias"},
                ],
            )
        return

    if state == "ask_days":
        days = _parse_days(text)
        if not days:
            await wa.send_text(phone, "Por favor, me diz quantos dias (ex: 5)")
            return
        conv["days"] = days
        conv["state"] = "generating"
        await wa.send_text(
            phone,
            f"⏳ *Gerando seu roteiro de {days} dias para {conv['destination']}...*\n"
            "Validando lugares no Google Maps e organizando por proximidade. "
            "Isso leva de 30 segundos a 2 minutos."
        )
        asyncio.create_task(_generate_itinerary(phone, wa))
        return

    # Default fallback
    await wa.send_text(
        phone,
        "Não entendi. Envie *oi* para recomeçar ou mande um link de viagem!"
    )


async def handle_button_reply(
    phone: str, button_id: str, message_id: str, wa: WhatsAppClient
) -> None:
    """Handle interactive button replies."""
    await wa.mark_read(message_id)
    conv = _get_conversation(phone)

    if button_id.startswith("days_"):
        days = int(button_id.replace("days_", ""))
        conv["days"] = days
        conv["state"] = "generating"
        await wa.send_text(
            phone,
            f"⏳ *Gerando seu roteiro de {days} dias para {conv['destination']}...*\n"
            "Validando lugares no Google Maps e organizando por proximidade. "
            "Isso leva de 30 segundos a 2 minutos."
        )
        asyncio.create_task(_generate_itinerary(phone, wa))


async def _send_welcome(phone: str, wa: WhatsAppClient) -> None:
    """Send welcome message."""
    await wa.send_text(
        phone,
        "👋 *Bem-vindo ao Voyara!*\n\n"
        "Sou seu planejador de viagem com IA. Posso criar roteiros completos "
        "a partir de vídeos do TikTok, Instagram e YouTube.\n\n"
        "🎯 *Como funciona:*\n"
        "1️⃣ Envie um link de um vídeo de viagem\n"
        "2️⃣ Me diga quantos dias vai ficar\n"
        "3️⃣ Receba um roteiro completo com horários, mapas e dicas\n\n"
        "📎 *Cole um link pra começar!*\n"
        "Ou me diga o destino (ex: \"Paris 5 dias\")"
    )


async def _extract_and_continue(
    phone: str, url: str, wa: WhatsAppClient
) -> None:
    """Extract content from URL and ask for destination/days."""
    conv = _get_conversation(phone)
    try:
        content_text = await _extract_content(url)
        conv["content_text"] = content_text

        if not content_text.strip():
            conv["state"] = "ask_destination"
            await wa.send_text(
                phone,
                "⚠️ Não consegui extrair conteúdo desse link. "
                "Mas sem problemas! Me diz o *destino* da viagem:"
            )
            return

        # Try to detect destination from content using AI
        destination = await _detect_destination_from_content(content_text)

        if destination:
            conv["destination"] = destination
            conv["state"] = "ask_days"
            await wa.send_buttons(
                phone,
                f"✅ *Link analisado!*\n\n"
                f"Detectei que o destino é *{destination}*.\n"
                f"Quantos dias vai ficar?",
                [
                    {"id": "days_3", "title": "3 dias"},
                    {"id": "days_5", "title": "5 dias"},
                    {"id": "days_7", "title": "7 dias"},
                ],
            )
        else:
            conv["state"] = "waiting_destination"
            await wa.send_text(
                phone,
                "✅ *Link analisado!*\n\n"
                "Encontrei vários lugares interessantes! "
                "Qual é o *destino* da viagem?"
            )
    except Exception as e:
        logger.error("[whatsapp] Extraction failed for %s: %s", url, e)
        conv["state"] = "ask_destination"
        await wa.send_text(
            phone,
            "⚠️ Tive um problema ao analisar o link. "
            "Me diz o *destino* da viagem que eu monto o roteiro:"
        )


async def _detect_destination_from_content(content: str) -> str | None:
    """Use Haiku to quickly detect the destination from extracted content."""
    if not content.strip():
        return None
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    try:
        response = await asyncio.to_thread(
            lambda: client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=50,
                messages=[{
                    "role": "user",
                    "content": (
                        "What travel destination is this content about? "
                        "Reply with ONLY the city/region name, nothing else. "
                        "If unclear, reply UNKNOWN.\n\n"
                        f"{content[:3000]}"
                    ),
                }],
            )
        )
        dest = response.content[0].text.strip()
        if dest.upper() == "UNKNOWN" or len(dest) > 50:
            return None
        return dest
    except Exception as e:
        logger.warning("[whatsapp] Destination detection failed: %s", e)
        return None


async def _generate_itinerary(phone: str, wa: WhatsAppClient) -> None:
    """Generate itinerary and send results via WhatsApp."""
    conv = _get_conversation(phone)
    destination = conv.get("destination", "")
    days = conv.get("days", 5)
    content_text = conv.get("content_text", "")

    try:
        cost = CostTracker(link_id=0)

        # Build fake trip/day_plans structure for the prompt builder
        trip = {"destination": destination, "traveler_profile": {}}
        day_plans = [{"day_number": d, "city": None} for d in range(1, days + 1)]

        prompt = _build_itinerary_prompt(
            content_text or f"Trip to {destination}",
            trip, day_plans, [], [], [], [],
        )

        expected_items = days * 5
        place_list = await _call_claude_for_itinerary(prompt, cost, expected_items=expected_items)

        if not place_list:
            await wa.send_text(phone, "❌ Não consegui gerar o roteiro. Tente novamente com *oi*.")
            conv["state"] = "idle"
            return

        # Validate top places with Google Places for coordinates
        places_client = GooglePlacesClient()
        validated = await _quick_validate(place_list, destination, places_client)

        # Send itinerary day by day
        await _send_itinerary(phone, wa, validated, destination, days)

        conv["state"] = "idle"

    except Exception as e:
        logger.exception("[whatsapp] Itinerary generation failed")
        await wa.send_text(
            phone,
            "❌ Ocorreu um erro ao gerar o roteiro. Envie *oi* para tentar novamente."
        )
        conv["state"] = "idle"


async def _quick_validate(
    places: list[dict], destination: str, client: GooglePlacesClient
) -> list[dict]:
    """Quick Google Places validation for top places (no details fetch)."""
    semaphore = asyncio.Semaphore(10)

    async def validate_one(place: dict) -> dict:
        name = place.get("name", "")
        city = place.get("city", destination)
        async with semaphore:
            try:
                results = await client.search(f"{name} {city}", city)
                if results:
                    best = results[0]
                    place["latitude"] = best.get("latitude")
                    place["longitude"] = best.get("longitude")
                    place["google_rating"] = best.get("rating")
                    place["address"] = best.get("address")
            except Exception:
                pass
        return place

    return await asyncio.gather(*[validate_one(p) for p in places])


async def _send_itinerary(
    phone: str,
    wa: WhatsAppClient,
    places: list[dict],
    destination: str,
    num_days: int,
) -> None:
    """Format and send itinerary as WhatsApp messages, one per day."""
    # Group by day
    by_day: dict[int, list[dict]] = {}
    for p in places:
        d = p.get("day", 1)
        by_day.setdefault(d, []).append(p)

    # Header
    total = len(places)
    await wa.send_text(
        phone,
        f"🗺️ *Roteiro: {destination} — {num_days} dias*\n"
        f"📍 {total} lugares validados no Google Maps\n"
        f"━━━━━━━━━━━━━━━━━━━━"
    )

    await asyncio.sleep(0.5)

    # Send each day
    for day_num in range(1, num_days + 1):
        day_places = by_day.get(day_num, [])
        if not day_places:
            continue

        # Sort by time_slot
        day_places.sort(key=lambda p: p.get("time_slot", "12:00"))

        lines = [f"📅 *Dia {day_num}*\n"]
        for p in day_places:
            time = p.get("time_slot", "")
            name = p.get("name", "?")
            cat = p.get("category", "")
            duration = p.get("duration_minutes", 60)
            desc = p.get("description", "")
            rating = p.get("google_rating")

            emoji = _category_emoji(cat)
            rating_str = f" ⭐{rating}" if rating else ""
            duration_str = f" ({duration}min)" if duration else ""

            lines.append(f"*{time}* {emoji} *{name}*{rating_str}{duration_str}")
            if desc:
                lines.append(f"  _{desc[:120]}_")
            lines.append("")

        msg = "\n".join(lines)
        await wa.send_text(phone, msg)
        await asyncio.sleep(0.3)

    # Footer with Google Maps links
    has_coords = [p for p in places if p.get("latitude") and p.get("longitude")]
    if has_coords:
        # Build a multi-stop Google Maps URL for day 1
        day1 = by_day.get(1, [])
        coords_with_loc = [p for p in day1 if p.get("latitude")]
        if coords_with_loc:
            waypoints = "/".join(
                f"{p['latitude']},{p['longitude']}" for p in coords_with_loc[:5]
            )
            maps_url = f"https://www.google.com/maps/dir/{waypoints}"
            await wa.send_text(
                phone,
                f"🗺️ *Mapa do Dia 1:*\n{maps_url}"
            )

    await wa.send_text(
        phone,
        "✅ *Roteiro completo!*\n\n"
        "💡 Quer ver mais detalhes ou ajustar algo?\n"
        "Acesse: voyara-n5q8.onrender.com\n\n"
        "Envie *oi* para criar outro roteiro!"
    )


def _category_emoji(cat: str) -> str:
    return {
        "restaurant": "🍽️",
        "cafe": "☕",
        "attraction": "🏛️",
        "activity": "🎯",
        "shopping": "🛍️",
        "nightlife": "🌙",
        "hotel": "🏨",
        "transport": "🚗",
    }.get(cat, "📍")


def _parse_days(text: str) -> int | None:
    """Extract number of days from text."""
    text = text.strip().lower()
    # Button reply IDs
    if text.startswith("days_"):
        return int(text.replace("days_", ""))
    # Direct number
    match = re.search(r"(\d+)", text)
    if match:
        n = int(match.group(1))
        if 1 <= n <= 30:
            return n
    return None
