"""
Main processing orchestrator — coordinates the full pipeline.

Both eco and pro modes share the same three-phase pipeline:
  Phase 0 (per-link): Extract content only → store → mark "extracted".
  Phase 1 (per-trip): Aggregate all extracted content → Haiku profile + city detection.
  Phase 2 (per-trip): Build unified itinerary after user confirms profile.
    - Eco: ONE structured Sonnet call → JSON → validate → create items.
    - Pro: Agentic Sonnet loop with validate_places + create_batch_items tools.
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import re

from difflib import SequenceMatcher

import anthropic

from app.ai.agent import TravelAgent
from app.ai.cost_tracker import CostTracker
from app.ai.tool_handlers import ToolHandlers
from app.config import settings
from app.extractors.youtube import YouTubeExtractor
from app.extractors.tiktok import TikTokExtractor
from app.extractors.instagram import InstagramExtractor
from app.extractors.web import WebExtractor
from app.google_places.client import GooglePlacesClient
from app.services.rails_client import RailsClient

logger = logging.getLogger(__name__)

_extractors = [
    YouTubeExtractor(),
    InstagramExtractor(),
    TikTokExtractor(),
    WebExtractor(),
]


async def process_link(
    link_id: int,
    trip_id: int,
    url: str,
    platform: str,
    ai_mode: str = "eco",
    http_client=None,
) -> dict:
    """Phase 0: Extract content from link. Same for both eco and pro modes."""
    return await _extract_link(link_id, trip_id, url, platform, http_client)


# ──────────────────────────────────────────────
# SHARED HELPERS
# ──────────────────────────────────────────────


async def _extract_content(url: str, deep: bool = True) -> str:
    """Extract text content from URL.

    Args:
        deep: when True, extractors run transcription + vision OCR in
              addition to caption/oEmbed (slow, used in background trip
              build). When False, only caption/oEmbed is used (fast,
              ≤15s — suitable for synchronous preview endpoints on
              free-tier hosting with 30s HTTP limits).
    """
    content_text = ""
    for ext in _extractors:
        if ext.can_handle(url):
            # Tell the extractor to run in shallow mode by setting a
            # thread-local flag; extractors check it and skip heavy work.
            _SHALLOW_EXTRACTION.value = not deep
            try:
                # Deep: Whisper (90s) + Vision OCR (75s, 12 frames) run in
                # parallel → ~95s clock. 240s absorbs cold start.
                timeout = 240 if deep else 15
                content = await asyncio.wait_for(ext.extract(url), timeout=timeout)
                parts = [content.title or "", content.description or ""]
                if content.captions:
                    parts.append(" ".join(content.captions[:50]))
                if content.comments:
                    parts.append(" ".join(content.comments[:10]))
                content_text = "\n".join(p for p in parts if p)
            except asyncio.TimeoutError:
                logger.warning("[extract] Extraction timed out for %s", url)
            except Exception as e:
                logger.warning("[extract] Extraction failed: %s", e)
            finally:
                _SHALLOW_EXTRACTION.value = False
            break

    return content_text


class _ShallowFlag:
    """Simple context holder — extractors check this to skip heavy work."""
    def __init__(self) -> None:
        self.value: bool = False


_SHALLOW_EXTRACTION = _ShallowFlag()


def is_shallow_extraction() -> bool:
    """Extractors call this to decide whether to skip transcript/vision."""
    return _SHALLOW_EXTRACTION.value


async def analyze_urls_deep(urls: list[str]) -> dict:
    """Deep analyze — runs audio transcription + on-screen OCR in addition
    to caption/oEmbed. Used by the async /analyze-url/start job.
    Typically 30-90s per URL. Never raises.
    """
    return await _analyze_urls_impl(urls, deep=True)


async def analyze_urls(urls: list[str]) -> dict:
    """Fast preview — caption/oEmbed only. Used by /analyze-url sync.
    Fits under 15s per URL even cold. Never raises.
    """
    return await _analyze_urls_impl(urls, deep=False)


async def _analyze_urls_impl(urls: list[str], deep: bool) -> dict:
    """Analyze URLs and return place info without creating database records.

    Never raises and never returns the unhelpful "could not parse" error.
    Degrades gracefully: if extraction or AI parsing fails, we still return
    something useful the frontend can show.

    Phase 2 addition: each URL is classified (A-F) individually, then the
    per-URL results are consolidated by `_resolve_multi_video_conflicts`.
    The flat `places` + `destination` fields stay in the response shape for
    backward compat with the current frontend, while the new
    `content_classification` blob carries the structured data that Phase 3
    will read to decide day rigidity.
    """
    import anthropic

    # 1. Extract content from all URLs. Depth depends on caller.
    per_url_content: dict[str, str] = {}  # url -> content
    combined_content = ""
    extraction_errors: list[str] = []
    debug_stats: dict[str, dict] = {}
    for url in urls[:5]:  # Max 5 URLs
        try:
            content = await _extract_content(url, deep=deep)
            if content:
                per_url_content[url] = content
                combined_content += f"\n--- Content from {url} ---\n{content}\n"
                logger.info(
                    "[analyze-urls] Extracted %d chars from %s (has [ON-SCREEN]: %s)",
                    len(content),
                    url,
                    "[ON-SCREEN TEXT]" in content,
                )
                debug_stats[url] = {
                    "chars": len(content),
                    "has_on_screen": "[ON-SCREEN TEXT]" in content,
                    "has_transcript": "[TRANSCRIPT]" in content,
                }
            else:
                logger.warning(
                    "[analyze-urls] Empty content from %s (extractor returned nothing)",
                    url,
                )
                extraction_errors.append(url)
        except asyncio.TimeoutError:
            logger.warning("[analyze-urls] Timeout extracting %s", url)
            extraction_errors.append(url)
        except Exception as e:
            logger.warning(
                "[analyze-urls] Failed to extract %s: %s (%s)",
                url,
                e,
                type(e).__name__,
            )
            extraction_errors.append(url)

    if not combined_content.strip():
        logger.warning(
            "[analyze-urls] No content extracted from URLs: %s (errors: %s)",
            urls,
            extraction_errors,
        )
        return {
            "places": [],
            "destination": None,
            "summary": (
                "Não conseguimos abrir esse link agora (vídeo privado, link "
                "quebrado ou plataforma bloqueando). Tente outro link, ou "
                "crie seu roteiro digitando o destino."
            ),
        }

    # 2. Classify + extract per URL in parallel (Phase 2)
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    classify_tasks = [
        _classify_and_extract(client, u, c) for u, c in per_url_content.items()
    ]
    classify_results = await asyncio.gather(*classify_tasks, return_exceptions=True)

    classified: list[dict] = []
    for url, res in zip(per_url_content.keys(), classify_results):
        if isinstance(res, dict):
            row = dict(res)
            row["source_url"] = url
            classified.append(row)
        elif isinstance(res, Exception):
            logger.warning("[classify] Exception for %s: %s", url, res)

    content_classification: dict = {}
    if classified:
        content_classification = _resolve_multi_video_conflicts(classified)
        logger.info(
            "[classify] Consolidated: destination=%s canonical_days=%d loose=%d "
            "tips=%d conflicts=%d",
            content_classification.get("destination"),
            len(content_classification.get("canonical_days") or {}),
            len(content_classification.get("loose_places") or []),
            len(content_classification.get("complementary_tips") or []),
            len(content_classification.get("conflicts_detected") or []),
        )

    # 3. Use legacy Haiku extractor for the flat `places` list that the
    # current frontend still reads. Phase 3 will retire this path and let
    # the UI consume content_classification directly.

    base_prompt = f"""Analyze this content and identify EVERY specific place mentioned, named, shown, or spoken about.

Content (may include [TRANSCRIPT] sections from the video's audio):
{combined_content[:15000]}

Return ONLY a JSON object (no markdown, no explanation text, no code fences):
{{"destination": "City, Country", "places": ["Place Name 1", "Place Name 2"], "summary": "One sentence about what the content is about"}}

REGRAS CRÍTICAS (siga ao pé da letra):

1. EXAUSTIVO. Se o [ON-SCREEN TEXT] tem 7 linhas com nomes de lugares,
   o array 'places' TEM que ter pelo menos 7 itens. Se o [TRANSCRIPT]
   menciona mais 10, são 17. Não decida sozinho que um nome é "genérico demais".

2. Qualquer SUBSTANTIVO PRÓPRIO que pareça nome de lugar → INCLUIR.
   Se começa com maiúscula e é substantivo (rua, avenida, praça, ponte,
   catedral, mercado, museu, teatro, centro, parque, praia, bairro etc.)
   seguido de nome próprio → INCLUIR.

   EXEMPLOS que DEVEM entrar (não filtre!):
   - "Rua Florida" → INCLUIR (rua específica famosa de BA)
   - "Catedral Metropolitana" → INCLUIR (monumento específico)
   - "Praça Domingo Perón" → INCLUIR (nome próprio da praça)
   - "Ponte da Mulher" → INCLUIR
   - "Centro Cultural Kirchner" → INCLUIR
   - "Avenida 9 de Julho" → INCLUIR
   - "Galerías Pacífico" → INCLUIR
   - "La Boca" → INCLUIR (bairro com nome próprio)
   - "Caminito" → INCLUIR
   - "Obelisco" → INCLUIR (mesmo como nome comum, é monumento único)

3. Se o conteúdo falar "Day 1: X Y Z" / "Day 2: A B C" / "Day 3: P Q R",
   liste TUDO (X Y Z A B C P Q R) — não resuma um dia no seu cabeçalho.

4. Atividades viram places:
   - "passeio de barco Rio da Prata" → "Passeio de barco Rio da Prata"
   - "show de tango" → "Show de tango em Palermo" (ou similar)

5. Ordem de prioridade para extrair:
   a) [ON-SCREEN TEXT] — texto sobreposto do criador
   b) [TRANSCRIPT] — fala do criador
   c) description/caption — legenda escrita

6. ÚNICOS filtros legítimos (o resto TEM que entrar):
   - Referências de comparação ("como X em Vegas") — esse X NÃO entra
   - Coisas genéricas sem nome ("um café legal") — NÃO entra
   - Duplicatas exatas — apareceu 2x, lista 1x

7. Limite: até 50 lugares.

8. Summary: uma frase.

IMPORTANT: If you cannot find any place names, still return valid JSON with
empty "places" array and a summary explaining what the content seems to be
about."""

    parsed = await _analyze_urls_with_retries(client, base_prompt)

    if not isinstance(parsed, dict):
        # Haiku failed (credits exhausted, rate-limited, etc.). Fall back to
        # a regex extraction of numbered/keycap-emoji lists so we still give
        # the user something actionable instead of an empty modal.
        logger.error("[analyze-urls] All Haiku attempts failed; trying regex fallback")
        fallback = _regex_extract_places(combined_content)
        if fallback.get("places"):
            logger.info(
                "[analyze-urls] Regex fallback recovered %d places (destination=%s)",
                len(fallback["places"]),
                fallback.get("destination"),
            )
            parsed = fallback
        else:
            return {
                "places": [],
                "destination": None,
                "summary": (
                    "Conseguimos ler o link, mas a IA teve dificuldade em identificar "
                    "lugares específicos agora. Tente de novo em alguns segundos, "
                    "ou digite o destino manualmente para criar um roteiro."
                ),
            }

    destination = parsed.get("destination") or ""
    place_names = parsed.get("places") or []
    summary = parsed.get("summary") or ""
    # Guard against wrong types
    if not isinstance(place_names, list):
        place_names = []
    if not isinstance(destination, str):
        destination = str(destination) if destination else ""
    if not isinstance(summary, str):
        summary = str(summary) if summary else ""

    if not place_names:
        return {"places": [], "destination": destination, "summary": summary}

    # 3. Enrich each place with Google Places data
    places_client = GooglePlacesClient()
    enriched_places = []

    try:
        # Respect the up-to-50 limit enforced by the Haiku prompt. Hard-cap
        # was 10 previously — that truncated real findings from long videos.
        # Dedupe by normalized name so Haiku duplicates ('Sunset Rio de la
        # Plata' returned twice) don't create duplicate cards.
        seen_norms: set[str] = set()
        unique_names: list[str] = []
        for pn in place_names[:50]:
            if not isinstance(pn, str):
                continue
            norm = _normalize_place_name(pn)
            if not norm or norm in seen_norms:
                continue
            seen_norms.add(norm)
            unique_names.append(pn)

        for place_name in unique_names:
            try:
                # Search for the place
                search_results = await places_client.search(place_name, destination)
                if not search_results:
                    enriched_places.append({"name": place_name, "source_url": urls[0] if urls else None})
                    continue

                # Get details for the top result
                top = search_results[0]
                details = await places_client.get_details(top["place_id"])

                if details:
                    enriched_places.append({
                        "name": details.get("name", place_name),
                        "address": details.get("address"),
                        "latitude": details.get("latitude"),
                        "longitude": details.get("longitude"),
                        "rating": details.get("rating"),
                        "reviews_count": details.get("reviews_count"),
                        "website": details.get("website"),
                        "phone": details.get("phone"),
                        "google_maps_url": details.get("google_maps_url"),
                        "operating_hours": details.get("operating_hours"),
                        "pricing": details.get("pricing"),
                        "photos": details.get("photos", []),
                        "types": details.get("types", []),
                        "source_url": urls[0] if urls else None,
                    })
                else:
                    enriched_places.append({
                        "name": top.get("name", place_name),
                        "address": top.get("address"),
                        "latitude": top.get("latitude"),
                        "longitude": top.get("longitude"),
                        "rating": top.get("rating"),
                        "reviews_count": top.get("user_ratings_total"),
                        "source_url": urls[0] if urls else None,
                    })
            except Exception as e:
                logger.warning("[analyze-urls] Failed to enrich %s: %s", place_name, e)
                enriched_places.append({"name": place_name, "source_url": urls[0] if urls else None})
    finally:
        await places_client.close()

    # If the Phase 2 classifier agrees on a destination and we don't have
    # one yet, use it.
    if not destination and content_classification.get("destination"):
        destination = content_classification["destination"]

    return {
        "places": enriched_places,
        "destination": destination,
        "summary": summary,
        # Phase 2 structured output. Downstream phases (day rigidity, refine,
        # frontend badges) read from here. When empty, behavior falls back
        # to the legacy flat `places` list.
        "content_classification": content_classification,
        "debug": debug_stats,
        "debug_raw": combined_content[:8000],
        "debug_haiku_raw": _last_haiku_response.get("raw", ""),
    }


# Keycap-emoji digits (1️⃣ through 🔟). These appear in almost every numbered
# TikTok/Reels "places to visit" title.
_KEYCAP_EMOJI = {
    "1\uFE0F\u20E3": 1, "2\uFE0F\u20E3": 2, "3\uFE0F\u20E3": 3,
    "4\uFE0F\u20E3": 4, "5\uFE0F\u20E3": 5, "6\uFE0F\u20E3": 6,
    "7\uFE0F\u20E3": 7, "8\uFE0F\u20E3": 8, "9\uFE0F\u20E3": 9,
    "\U0001F51F": 10,
}
_KEYCAP_RE = re.compile(
    "(" + "|".join(re.escape(k) for k in _KEYCAP_EMOJI.keys()) + ")"
)
# Generic emoji range — strip so names stay clean. Covers most pictographs.
_EMOJI_STRIP_RE = re.compile(
    "[\U0001F000-\U0001FAFF"        # Mahjong through Symbols & Pictographs Extended-A
    "\U00002600-\U000027BF"          # Misc symbols + dingbats
    "\u2300-\u23FF"                  # Misc technical (watches, hourglass, etc.)
    "\uFE00-\uFE0F\u200D\u20E3]+"   # Variation selectors + ZWJ + keycap combiner
)
# Numbered list patterns: "1. Name", "1) Name", "#1 Name"
_NUMBERED_RE = re.compile(r"(?:^|\s|\n)(?:#?\d{1,2})[\.\)]\s+([^\n\r]+?)(?=(?:\s#?\d{1,2}[\.\)])|\n|$)")
# Destinations we reliably spot in TikTok titles. Only used as a heuristic —
# the Haiku path is always preferred when credits are available.
_DESTINATION_HINTS = [
    "Buenos Aires", "Paris", "Rome", "Roma", "Tokyo", "Tóquio", "New York",
    "Nova York", "London", "Londres", "Barcelona", "Lisbon", "Lisboa",
    "Rio de Janeiro", "São Paulo", "Istanbul", "Dubai", "Bangkok",
    "Berlin", "Berlim", "Amsterdam", "Amsterdã", "Madrid", "Madri",
    "Vienna", "Viena", "Prague", "Praga", "Budapest", "Budapeste",
    "Porto", "Fortaleza", "Salvador", "Recife", "Florianópolis",
    "Mexico City", "Cidade do México", "Cancún", "Cancun",
    "Los Angeles", "San Francisco", "Miami", "Chicago",
    "Santiago", "Mendoza", "Bariloche", "Cartagena", "Medellín",
    "Cusco", "Lima", "Punta Cana", "Florença", "Florence",
    "Milan", "Milão", "Veneza", "Venice", "Nápoles", "Naples",
]


def _regex_extract_places(text: str) -> dict:
    """Extract place names from numbered/keycap-emoji lists when Haiku fails.

    Handles the most common TikTok/Reels title pattern:
        "6 PASSEIOS EM X 1️⃣ Place A 2️⃣ Place B 3️⃣ Place C ..."
    and the numbered fallback "1. Name 2. Name". Returns at most 20 places.
    Conservative by design — prefers false negatives over bogus matches.

    Also infers a heuristic `content_type` when possible:
      - "DIA 1/2/3" or "Day 1/2/3" markers → D (closed_day_by_day)
      - Single keycap/numbered item                → A (single_place)
      - Multiple keycap items, no day markers      → B (loose_list)
      - No signal                                   → B with low confidence
    """
    if not text:
        return {"places": [], "destination": None, "summary": "", "content_type": "B", "confidence": 0.0}

    places: list[str] = []

    # Try keycap-emoji split first (TikTok's dominant format).
    parts = _KEYCAP_RE.split(text)
    if len(parts) >= 3:  # Means at least one keycap boundary was found
        # parts alternates: [pre, keycap, between, keycap, between, ..., tail]
        for i in range(2, len(parts), 2):
            chunk = parts[i]
            # Stop at the first hashtag, newline, or obvious sentence break.
            chunk = re.split(r"[#\n\r]|\s{3,}", chunk, 1)[0]
            name = _EMOJI_STRIP_RE.sub(" ", chunk)
            name = re.sub(r"\s+", " ", name).strip(" -–—:.,;")
            # Drop trailing connector words/short junk.
            if 3 <= len(name) <= 80 and not name.isdigit():
                places.append(name)

    # Numbered-list fallback (e.g. descriptions without emojis)
    if not places:
        for m in _NUMBERED_RE.finditer(text):
            raw = m.group(1).strip()
            name = _EMOJI_STRIP_RE.sub(" ", raw)
            name = re.sub(r"\s+", " ", name).strip(" -–—:.,;")
            # Trim at obvious sentence-enders
            name = re.split(r"[—–]{1}\s|  ", name, 1)[0].strip()
            if 3 <= len(name) <= 80 and not name.isdigit():
                places.append(name)

    # Dedupe preserving order
    seen: set[str] = set()
    unique: list[str] = []
    for p in places:
        k = p.lower()
        if k not in seen:
            seen.add(k)
            unique.append(p)
    unique = unique[:20]

    # Destination hint — first known city token found in the text.
    destination: str | None = None
    lowered = text.lower()
    for hint in _DESTINATION_HINTS:
        if hint.lower() in lowered:
            destination = hint
            break

    summary = ""
    if unique:
        summary = (
            f"Extraímos {len(unique)} lugares do texto do link (modo de "
            "recuperação — a análise de IA não estava disponível no momento)."
        )

    # Heuristic content_type for the fallback path.
    has_day_marker = bool(
        re.search(r"(?i)(dia|day)\s*[1-9]", text)
        or re.search(r"roteiro\s+de\s+\d+\s+dias?", text, re.I)
    )
    if not unique:
        content_type, confidence = "B", 0.0
    elif has_day_marker:
        content_type, confidence = "D", 0.55  # regex can't tell order reliably
    elif len(unique) == 1:
        content_type, confidence = "A", 0.6
    else:
        content_type, confidence = "B", 0.7

    return {
        "places": unique,
        "destination": destination,
        "summary": summary,
        "content_type": content_type,
        "confidence": confidence,
    }


def _parse_json_response(raw: str) -> list | dict | None:
    """Parse JSON from Claude response. Tries multiple strategies so that
    even messy responses (markdown, prefixes, trailing text, truncated) have
    a good chance of being recoverable."""
    if not raw or not raw.strip():
        return None

    clean = raw.strip()

    # Strategy 1: strip code fences, then direct parse
    stripped = clean
    if stripped.startswith("```"):
        first_newline = stripped.find("\n")
        stripped = stripped[first_newline + 1:] if first_newline != -1 else stripped[3:]
    if stripped.rstrip().endswith("```"):
        stripped = stripped.rstrip()[:-3]
    try:
        return json.loads(stripped.strip())
    except json.JSONDecodeError:
        pass

    # Strategy 2: greedy match widest object/array substring
    for pattern in [r'\{[\s\S]*\}', r'\[[\s\S]*\]']:
        match = re.search(pattern, clean)
        if match:
            candidate = match.group()
            try:
                return json.loads(candidate)
            except json.JSONDecodeError:
                # Strategy 3: fix common trailing garbage / truncation
                # Try incrementally trimming trailing chars until it parses
                for cut in range(len(candidate), max(len(candidate) - 200, 1), -1):
                    try:
                        return json.loads(candidate[:cut])
                    except json.JSONDecodeError:
                        continue

    # Strategy 4: try balancing braces if truncated
    last_open = clean.rfind("{")
    last_close = clean.rfind("}")
    if last_open != -1 and last_close > last_open:
        try:
            return json.loads(clean[last_open:last_close + 1])
        except json.JSONDecodeError:
            pass

    # Strategy 5: LAST resort — salvage by closing open braces/brackets
    salvage = _salvage_truncated_json(clean)
    if salvage is not None:
        return salvage

    return None


def _salvage_truncated_json(text: str) -> dict | list | None:
    """If the JSON is truncated mid-value, try to balance and parse."""
    # Find the first { or [
    first_open = -1
    for i, c in enumerate(text):
        if c in "{[":
            first_open = i
            break
    if first_open == -1:
        return None

    stack: list[str] = []
    in_string = False
    escaped = False
    last_complete = -1

    for i, c in enumerate(text[first_open:], first_open):
        if escaped:
            escaped = False
            continue
        if c == "\\":
            escaped = True
            continue
        if c == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if c in "{[":
            stack.append(c)
        elif c in "}]":
            if stack:
                stack.pop()
            if not stack:
                last_complete = i + 1
                break

    # If we found a complete top-level object/array, try that
    if last_complete > 0:
        try:
            return json.loads(text[first_open:last_complete])
        except json.JSONDecodeError:
            pass

    # Otherwise close dangling brackets with matching closers
    partial = text[first_open:]
    if in_string:
        partial += '"'
    # Close in reverse order
    closers = {"{": "}", "[": "]"}
    for opener in reversed(stack):
        partial += closers[opener]
    try:
        return json.loads(partial)
    except json.JSONDecodeError:
        return None


_last_haiku_response: dict[str, str] = {"raw": ""}


# ──────────────────────────────────────────────────────────────────
# Phase 2 — Content-type classifier A-F
# ──────────────────────────────────────────────────────────────────
#
# Every link gets classified into one of six categories so the downstream
# pipeline can decide HOW to respect it:
#
#   A — single_place          1 place mentioned ("this café is worth it")
#   B — loose_list            List of places, no day structure ("6 passeios")
#   C — partial_itinerary     Conditional ("if you have 2 days, do...")
#   D — closed_day_by_day     Explicit "Day 1: X / Day 2: Y" — MOST structured
#   E — day_trip              Full-day out-of-city trip ("Tigre from BA")
#   F — complementary_tip     Single non-day-filling tip (a restaurant, a bar)
#
# Priority when multiple videos disagree: D > C > E > B > A > F.
# Higher-priority categories "own" the days they cover; lower categories
# contribute complementary_tips that get encaixed later.

CONTENT_TYPES = ("A", "B", "C", "D", "E", "F")
CONTENT_TYPE_PRIORITY = {t: p for p, t in enumerate(("F", "A", "B", "E", "C", "D"))}


def _build_classify_prompt(url: str, content: str) -> str:
    """Prompt that asks Haiku to classify + extract in a single pass."""
    return f"""You are analyzing ONE travel video/link for a travel-planning app. Your job is to
(1) classify the content into one of 6 categories, and (2) extract every place plus any
explicit day-by-day structure.

Content from {url}:
{content[:12000]}

Return ONLY a JSON object (no markdown, no prose, no code fences):
{{
  "destination": "City, Country",
  "base_city": "Buenos Aires",
  "content_type": "A|B|C|D|E|F",
  "confidence": 0.0-1.0,
  "creator_handle": "@handle or null",
  "detected_days": [
    {{
      "day": 1,
      "places": ["Place A", "Place B"],
      "region_hint": "Microcentro",
      "is_day_trip": false,
      "activity_hints": ["rooftop bar with city view", "nearby waterfall"],
      "alternatives": [{{"day": 3, "options": ["rooftop bar", "shopping mall"]}}]
    }}
  ],
  "loose_places": ["Place X", "Place Y"],
  "complementary_tips": [{{"name": "Café X", "category": "cafe"}}],
  "day_trip_suggestions": [{{"base_city": "Buenos Aires", "destination": "Tigre", "mentioned_duration_hours": 8}}],
  "pace_signals": {{"items_per_day_avg": 4, "pace": "leve|moderado|acelerado"}},
  "vibe_signature": ["urbano", "estetico", "cafes"],
  "raw_summary": "One sentence."
}}

ACTIVITY HINT EXTRACTION (CRITICAL — this is where most fidelity is lost):
The video often contains SUGGESTIONS that are not proper-noun places:
  • "rooftop ou shopping" → Day 3 activity_hint: "rooftop bar" AND "shopping mall"
  • "cachoeira próxima" / "nearby waterfall" → activity_hint: "nearby waterfall"
  • "festa à noite" → activity_hint: "nightlife"
  • "compras antes do voo" → activity_hint: "shopping before departure"
  • "mercado de rua para comer" → activity_hint: "street food market"
  • "templo da montanha" → activity_hint: "mountain temple"
For EVERY day in detected_days, extract these activity_hints if they appear
in the transcript for THAT day. These hints tell the downstream generator
that the creator DID suggest something specific for that day — even if no
proper noun was used — and the generator MUST honor that with a concrete
venue in that day's base city. Missing these hints is the #1 cause of
"the video said X but the generated trip has Y" complaints.

ALTERNATIVES EXTRACTION:
When the creator offers TWO or more mutually exclusive options for the
same day ("rooftop OU shopping", "Similan OU James Bond islands"), add
them to the `alternatives` array with their day. Don't pick one — capture
both so the UI can surface them as alternative_group cards.

CATEGORY CRITERIA (strict — pick one, set confidence honestly):

A — single_place: ONE place is the entire content ("this café in BA is amazing").
   → `loose_places` has exactly 1 entry. `detected_days` is empty.

B — loose_list: 2+ places WITHOUT day structure ("6 passeios em Buenos Aires").
   Keycap emojis (1️⃣2️⃣) or "Top N" intros = strong signal.
   → `loose_places` has the items. `detected_days` is empty.

C — partial_itinerary: Conditional ("if you have 2 days, do X Y / if 3 days, add Z").
   → `detected_days` may have structure but marked with `partial: true` in region_hint.

D — closed_day_by_day: EXPLICIT "Dia 1: ..., Dia 2: ..., Dia 3: ..." with at least
   2 numbered days. This is the MOST structured category. Transcript or on-screen
   text must say "dia 1" / "day 1" / "1️⃣" before a list.
   → `detected_days` is filled with one entry per day.

E — day_trip: A full-day out-of-city trip described ("Tigre saindo de Buenos Aires",
   "day trip from Paris to Versailles"). Content is one day, in a city that is NOT
   the base_city.
   → `detected_days` has 1 entry with `is_day_trip: true`.

F — complementary_tip: ONE place that is a tip, not a full day ("this restaurant",
   "this bar", "this hidden café"). Distinguished from A by: A is the WHOLE content
   focus; F is a small tip inside a broader vlog.
   → `complementary_tips` has 1 entry. `loose_places` and `detected_days` are empty.

CONFIDENCE CALIBRATION:
- 0.90-1.00: explicit day numbering or unambiguous single-place focus.
- 0.70-0.89: strong signals but some ambiguity.
- 0.50-0.69: mixed signals — pick best category but flag via low confidence.
- <0.50: DO NOT use — downgrade to a more general category (D→C→B).

EXTRACTION RULES:
- Capture EVERY proper-noun place mentioned in caption, transcript, or on-screen text.
- Categorize places by day ONLY when the content explicitly assigns them to a day.
- Otherwise put them in `loose_places`.
- `complementary_tips` is ONLY for clear tips ("essa cafeteria vale") inside a broader list.
- Creator handle: extract "@user" from captions if present, else null.
- pace.items_per_day_avg: count items per day when explicit; null if unclear.
- vibe_signature: 3-6 short tags describing the mood (urbano, estetico, aventura, gastronomia).

IF the content is empty/broken: return content_type "B", confidence 0.0, empty arrays, summary "Conteúdo não disponível."."""


async def _classify_and_extract(
    client, url: str, content: str
) -> dict | None:
    """Phase 2 — single Haiku call that classifies AND extracts per URL.

    Returns the classification dict, or None if every retry failed. The
    caller falls back to `_regex_extract_places` (which now also fills a
    heuristic content_type) when None is returned.

    Single attempt, short timeout: the fallback (regex) is instant, so it's
    cheaper to fail fast than burn 70s on retries that might not help.
    """
    prompt = _build_classify_prompt(url, content)
    attempts = [
        (lambda: [{"role": "user", "content": prompt}], "primary"),
    ]

    for build_messages, label in attempts:
        try:
            response = await asyncio.wait_for(
                asyncio.to_thread(
                    lambda: client.messages.create(
                        model="claude-haiku-4-5-20251001",
                        max_tokens=3000,
                        messages=build_messages(),
                        timeout=20.0,
                    )
                ),
                timeout=25.0,
            )
            text = response.content[0].text if response.content else ""
            if not text:
                continue
            if label == "prefill":
                text = '{"destination"' + text
            parsed = _parse_json_response(text)
            if not isinstance(parsed, dict):
                logger.warning("[classify] %s: parse failed (%s...)", label, text[:200])
                continue
            if parsed.get("content_type") not in CONTENT_TYPES:
                logger.warning(
                    "[classify] %s: unknown content_type=%r, coercing to B",
                    label, parsed.get("content_type"),
                )
                parsed["content_type"] = "B"
                parsed["confidence"] = min(float(parsed.get("confidence") or 0.5), 0.5)
            logger.info(
                "[classify] %s: type=%s confidence=%.2f days=%d loose=%d for %s",
                label,
                parsed["content_type"],
                float(parsed.get("confidence") or 0),
                len(parsed.get("detected_days") or []),
                len(parsed.get("loose_places") or []),
                url,
            )
            return parsed
        except Exception as e:
            logger.warning("[classify] %s attempt failed for %s: %s", label, url, e)

    return None


def _resolve_multi_video_conflicts(classified: list[dict]) -> dict:
    """Merge per-URL classifications into one consolidated plan.

    Rules (confirmed with user):
      1. Higher-priority category WINS ownership of the day it covers.
         Priority: D > C > E > B > A > F
      2. Ties broken by submission order (first URL wins).
      3. Low-confidence classifications (<0.5) are downgraded — their
         detected_days become loose_places instead.
      4. Losing video's places go to `complementary_tips` (still usable).

    Output shape:
      {
        "destination": str,                 # first non-empty one
        "base_city": str,
        "canonical_days": {int: {...}},     # day_number -> owning video's data
        "loose_places": [name, ...],
        "complementary_tips": [{name, category, source_url}],
        "day_trip_suggestions": [...],
        "pace_signals": {...},              # averaged from D-category videos
        "vibe_signature": [...],            # union
        "conflicts_detected": [...],        # for UI surfacing
        "creator_handles_by_day": {int: "@handle"},
        "per_url_types": {url: "D", ...},   # traceability
      }
    """
    canonical_days: dict[int, dict] = {}
    loose_places: list[str] = []
    complementary_tips: list[dict] = []
    day_trip_suggestions: list[dict] = []
    conflicts_detected: list[dict] = []
    vibe_tags: set[str] = set()
    pace_votes: list[str] = []
    items_per_day_votes: list[int] = []
    creator_handles_by_day: dict[int, str] = {}
    per_url_types: dict[str, str] = {}
    # Per-day mutually-exclusive options the creator offered
    # ("rooftop OU shopping"). Keyed by day → list of option lists.
    day_alternatives: dict[int, list[list[str]]] = {}
    destination = ""
    base_city = ""

    for row in classified:
        url = row.get("source_url") or ""
        ctype = row.get("content_type") or "B"
        confidence = float(row.get("confidence") or 0.0)
        per_url_types[url] = ctype

        if not destination and row.get("destination"):
            destination = row["destination"]
        if not base_city and row.get("base_city"):
            base_city = row["base_city"]

        # Downgrade very low-confidence D/C into loose_list B.
        if confidence < 0.5 and ctype in ("D", "C", "E"):
            logger.info(
                "[resolve] Downgrading %s (conf=%.2f) to B for %s",
                ctype, confidence, url,
            )
            ctype = "B"

        my_priority = CONTENT_TYPE_PRIORITY[ctype]
        detected = row.get("detected_days") or []

        for dd in detected:
            if not isinstance(dd, dict):
                continue
            day = dd.get("day")
            if not isinstance(day, int) or day < 1:
                continue
            places = [p for p in (dd.get("places") or []) if isinstance(p, str) and p.strip()]
            hints = [h for h in (dd.get("activity_hints") or []) if isinstance(h, str) and h.strip()]
            # A day counts as "detected" if it has EITHER places or hints.
            # A day with only hints ("cachoeira próxima" + nothing named) is
            # still creator guidance we need to honor.
            if not places and not hints:
                continue
            proposal = {
                "places": places,
                "activity_hints": hints,
                "region_hint": dd.get("region_hint"),
                "is_day_trip": bool(dd.get("is_day_trip")),
                "source_url": url,
                "content_type": ctype,
                "confidence": confidence,
                "creator": row.get("creator_handle"),
            }

            existing = canonical_days.get(day)
            if existing is None:
                canonical_days[day] = proposal
                if row.get("creator_handle"):
                    creator_handles_by_day[day] = row["creator_handle"]
                continue

            # Conflict — resolve by category priority, then submission order.
            existing_priority = CONTENT_TYPE_PRIORITY[existing["content_type"]]
            if my_priority > existing_priority:
                # I win: demote existing's places to complementary tips.
                for p in existing["places"]:
                    complementary_tips.append({
                        "name": p, "category": "other",
                        "source_url": existing["source_url"],
                        "demoted_from_day": day,
                    })
                conflicts_detected.append({
                    "day": day,
                    "winner_url": url,
                    "loser_url": existing["source_url"],
                    "reason": f"{ctype} beats {existing['content_type']}",
                })
                canonical_days[day] = proposal
                if row.get("creator_handle"):
                    creator_handles_by_day[day] = row["creator_handle"]
            elif my_priority < existing_priority:
                # Existing wins: my places become tips.
                for p in places:
                    complementary_tips.append({
                        "name": p, "category": "other",
                        "source_url": url,
                        "demoted_from_day": day,
                    })
                conflicts_detected.append({
                    "day": day,
                    "winner_url": existing["source_url"],
                    "loser_url": url,
                    "reason": f"{existing['content_type']} beats {ctype}",
                })
            else:
                # Same priority: first-submitted wins (already stored).
                for p in places:
                    complementary_tips.append({
                        "name": p, "category": "other",
                        "source_url": url,
                        "demoted_from_day": day,
                    })
                conflicts_detected.append({
                    "day": day,
                    "winner_url": existing["source_url"],
                    "loser_url": url,
                    "reason": "same category — first submitted wins",
                })

        # Top-level alternatives ("rooftop OU shopping" offered for a day)
        for alt in (row.get("alternatives") or []):
            if not isinstance(alt, dict):
                continue
            d = alt.get("day")
            opts = [o for o in (alt.get("options") or []) if isinstance(o, str) and o.strip()]
            if isinstance(d, int) and d >= 1 and len(opts) >= 2:
                day_alternatives.setdefault(d, []).append(opts)

        # Non-detected-day items
        for p in (row.get("loose_places") or []):
            if isinstance(p, str) and p.strip():
                loose_places.append(p.strip())
        for tip in (row.get("complementary_tips") or []):
            if isinstance(tip, dict) and tip.get("name"):
                t = dict(tip)
                t["source_url"] = url
                complementary_tips.append(t)
        for dts in (row.get("day_trip_suggestions") or []):
            if isinstance(dts, dict):
                day_trip_suggestions.append(dts)
        for v in (row.get("vibe_signature") or []):
            if isinstance(v, str):
                vibe_tags.add(v)
        ps = row.get("pace_signals") or {}
        if ps.get("pace"):
            pace_votes.append(ps["pace"])
        if isinstance(ps.get("items_per_day_avg"), (int, float)):
            items_per_day_votes.append(int(ps["items_per_day_avg"]))

    # Aggregate pace: mode
    pace = None
    if pace_votes:
        from collections import Counter
        pace = Counter(pace_votes).most_common(1)[0][0]

    items_per_day = None
    if items_per_day_votes:
        items_per_day = round(sum(items_per_day_votes) / len(items_per_day_votes))

    # Dedupe loose_places case-insensitively (preserve order)
    seen = set()
    deduped_loose: list[str] = []
    for p in loose_places:
        k = p.lower().strip()
        if k not in seen:
            seen.add(k)
            deduped_loose.append(p)

    return {
        "destination": destination,
        "base_city": base_city,
        "canonical_days": canonical_days,
        "loose_places": deduped_loose,
        "complementary_tips": complementary_tips,
        "day_trip_suggestions": day_trip_suggestions,
        "pace_signals": {"pace": pace, "items_per_day_avg": items_per_day},
        "vibe_signature": sorted(vibe_tags),
        "conflicts_detected": conflicts_detected,
        "creator_handles_by_day": creator_handles_by_day,
        "per_url_types": per_url_types,
        # Mutually-exclusive options per day (creator said "A OU B").
        # Downstream prompt uses alternative_group to surface both.
        "day_alternatives": day_alternatives,
    }


async def _analyze_urls_with_retries(client, base_prompt: str) -> dict | None:
    """Call Haiku up to 3 times with increasingly strict prompts.

    Attempt 1: standard prompt.
    Attempt 2: prefill assistant with "{" to force JSON object start.
    Attempt 3: terse follow-up "Return only the JSON, nothing else".
    """
    attempts = [
        # (messages_builder, label)
        (lambda: [{"role": "user", "content": base_prompt}], "primary"),
        (
            lambda: [
                {"role": "user", "content": base_prompt},
                {"role": "assistant", "content": "{"},
            ],
            "prefill",
        ),
        (
            lambda: [
                {
                    "role": "user",
                    "content": (
                        base_prompt
                        + "\n\nRESPOND WITH ONLY THE JSON OBJECT. NO OTHER TEXT."
                    ),
                },
                {"role": "assistant", "content": '{"destination"'},
            ],
            "strict",
        ),
    ]

    for build_messages, label in attempts:
        try:
            response = await asyncio.wait_for(
                asyncio.to_thread(
                    lambda: client.messages.create(
                        model="claude-haiku-4-5-20251001",
                        max_tokens=2000,
                        messages=build_messages(),
                        timeout=25.0,
                    )
                ),
                timeout=30.0,
            )
            text = response.content[0].text if response.content else ""
            if not text:
                logger.warning("[analyze-urls] %s: empty response", label)
                continue

            # Reconstruct if we prefilled
            if label == "prefill":
                text = "{" + text
            elif label == "strict":
                text = '{"destination"' + text

            parsed = _parse_json_response(text)
            _last_haiku_response["raw"] = text[:3000]
            if isinstance(parsed, dict):
                logger.info("[analyze-urls] Parsed on attempt: %s", label)
                return parsed
            else:
                logger.warning(
                    "[analyze-urls] %s: parse failed, raw=%s",
                    label,
                    text[:300],
                )
        except Exception as e:
            logger.error("[analyze-urls] %s attempt failed: %s", label, e)
            continue

    return None


async def _analyze_profile(content_text: str, destination: str, cost: CostTracker) -> dict | None:
    """Lightweight Haiku call to analyze traveler profile + detect cities.

    The prompt is strict about content quality: description must reference
    specific places by name, style must be 3-6 words (not "explorador"),
    interests must have at least 4 concrete items. A weak Haiku response
    triggers a retry and, if still weak, falls back to a content-aware
    default (see the bottom of this function).
    """
    prompt = f"""You are a travel psychology expert. Analyze this travel content to understand DEEPLY what kind of traveler this person is.

Don't just list categories — understand the VIBE. Are they the type who wakes up early to catch sunrise at a temple, or the type who sleeps in and finds a perfect brunch spot? Do they want Instagram-worthy views or authentic local experiences? Are they adventurous or prefer comfort?

This content comes from MULTIPLE travel inspiration links the user saved. Analyze ALL of it together to build a unified traveler profile.

Return ONLY a JSON object with BILINGUAL fields (both Portuguese and English):
{{"travel_style": "3-6 WORDS in Portuguese (e.g. 'explorador cultural com paixão gastronômica', 'aventureiro urbano de bairros locais'). NEVER a single generic word like 'explorador' — always 3+ words with a specific angle.",
"travel_style_en": "same 3-6 word style in English (e.g. 'cultural explorer with culinary passion', 'urban adventurer seeking local neighborhoods')",
"interests": ["AT LEAST 4 specific interests in Portuguese. 'cafés especiais' not 'café', 'street art em bairros alternativos' not 'arte'. Draw from what the content actually shows — if videos focus on food, list food-specific interests; if on architecture, list that."],
"interests_en": ["same 4+ interests in English — matching 1:1 with the Portuguese list"],
"pace": "leve|moderado|acelerado",
"country_detected": "Single country name in English (e.g. 'Thailand', 'Argentina', 'Italy'). CRITICAL: must be the country where the trip actually happens, NOT a country that shares letters with the trip name. If the user wrote 'Tailandia' (pt-BR for Thailand), this must be 'Thailand'. If ambiguous, use your best guess from place names in the content. Never leave empty.",
"cities_detected": ["City1", "City2"],
"profile_description": "MINIMUM 40 WORDS in PERFECT Brazilian Portuguese (pt-BR) with flawless grammar — proper accents (á, é, ã, õ, ô, ç, à), punctuation, and cedilla. MUST reference 2-3 specific places by NAME from the content. Example tone: 'Viajante com olhar curioso para bairros autênticos — o interesse por Palermo Soho e as ruas históricas de San Telmo revela alguém que valoriza descobertas locais e atmosfera. O estilo é urbano e ritmado, com espaço para cafés especiais e experiências gastronômicas.' Not a generic line; a vivid mini-portrait.",
"profile_description_en": "Same 40+ word portrait in English. Equally warm, specific, and rich.",
"places_mentioned": [{{"name": "Exact Place Name", "source_url": "https://...", "day": null}}],
"day_plans_from_links": [{{"day": 1, "places": ["Place A", "Place B", "Place C"], "source_url": "https://..."}}]}}

IMPORTANT:
- places_mentioned: Extract EVERY specific named place from the content — restaurants, attractions, cafes, parks, markets, hotels, bars, viewpoints, beaches, neighborhoods worth visiting, etc. Map each to its source URL (use the "--- Source: URL ---" headers in the content). Be THOROUGH — if a place is named in the content, it MUST appear here. Generic descriptions like "a nice cafe" or "the beach" don't count — only specifically named places (e.g., "In-N-Out Burger", "Griffith Observatory", "Café de Flore"). This list is critical — it tells the user which itinerary items came from their saved links. If a place is assigned to a specific day in the content, include "day": <number>.
- day_plans_from_links: If the content contains a PRE-PLANNED day-by-day itinerary (e.g., "Day 1: visit X, Y, Z" or "First day: we went to A, B, C"), extract the COMPLETE day structure here. Each entry = one day with its ordered list of place names. This is CRITICAL — when someone shares a complete travel plan, we MUST respect their exact day grouping. If the content is NOT organized by days (just a list of recommendations), leave this as an empty array [].
- cities_detected: List ONLY truly distinct cities/destinations that are far apart and require separate travel days (e.g., "Las Vegas" and "Zion National Park", or "Los Angeles" and "Joshua Tree").
  CRITICAL: Neighborhoods, districts, and nearby areas within the SAME metro area are NOT separate cities. For example: Venice, Santa Monica, Beverly Hills, Hollywood, Malibu are all part of "Los Angeles" — do NOT list them separately. Similarly, Brooklyn and Manhattan are both "New York City". Only list a place as a separate city if it's truly a different destination requiring 1+ hour of travel (like a national park, another city, etc.).
  If ALL content is about ONE city and its neighborhoods, return just ["City Name"].
- interests: Be specific and actionable (these will guide place recommendations).
- Destination context: {destination}

Content from multiple sources:
{content_text[:6000]}"""

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    # Retry up to 2 times on failure
    for attempt in range(2):
        try:
            response = await asyncio.wait_for(
                asyncio.to_thread(
                    lambda: client.messages.create(
                        model="claude-haiku-4-5-20251001",
                        max_tokens=2048,
                        messages=[{"role": "user", "content": prompt}],
                        timeout=35.0,
                    )
                ),
                timeout=40.0,
            )
            cost.record_usage(response.usage)
            raw = response.content[0].text if response.content else "{}"
        except asyncio.TimeoutError:
            logger.warning("[profile] Haiku TIMED OUT (attempt %d)", attempt + 1)
            if attempt == 0:
                await asyncio.sleep(2)
                continue
            return None
        except Exception as e:
            logger.warning("[profile] Haiku call failed (attempt %d): %s", attempt + 1, e)
            if attempt == 0:
                await asyncio.sleep(2)
                continue
            return None

        parsed = _parse_json_response(raw)
        if isinstance(parsed, dict):
            # Fill in any missing pieces with content-aware defaults — never
            # the generic one-liners the old fallback produced.
            _enrich_weak_profile(parsed, destination)
            # Dedup places_mentioned at source — sometimes Haiku emits the
            # same place twice (once per video, or once from transcript +
            # once from on-screen text). Downstream safety-net and
            # deduplicate_places work, but it's cleaner to kill duplicates
            # here before they propagate into the prompt and post-processing.
            raw_places = parsed.get("places_mentioned") or []
            seen_norms: set[str] = set()
            deduped: list[dict] = []
            for p in raw_places:
                name = (p.get("name") or "").strip() if isinstance(p, dict) else ""
                if not name:
                    continue
                norm = _normalize_place_name(name)
                if not norm or norm in seen_norms:
                    continue
                seen_norms.add(norm)
                deduped.append(p)
            if len(deduped) != len(raw_places):
                logger.info(
                    "[profile] places_mentioned dedup: %d → %d",
                    len(raw_places), len(deduped),
                )
            parsed["places_mentioned"] = deduped
            logger.info(
                "[profile] Profile parsed successfully with %d places mentioned",
                len(parsed.get("places_mentioned", [])),
            )
            return parsed

        logger.warning("[profile] Failed to parse profile response (attempt %d). Raw: %s", attempt + 1, raw[:300])
        if attempt == 0:
            await asyncio.sleep(2)

    # Both attempts failed — synthesize a non-generic profile from destination.
    fallback: dict = {}
    _enrich_weak_profile(fallback, destination)
    fallback["places_mentioned"] = []
    fallback["day_plans_from_links"] = []
    logger.warning("[profile] Using synthesized fallback profile for %s", destination)
    return fallback


def _enrich_weak_profile(parsed: dict, destination: str) -> None:
    """Upgrade any empty / trivially-generic field on a parsed profile to a
    non-embarrassing default. Mutates `parsed` in place.

    Rules of thumb:
      - travel_style is "weak" if it's < 3 words OR is literally "explorador" /
        "traveler" / "turista" / "viajante".
      - profile_description is weak if it's < 30 chars OR matches the old
        boilerplate pattern "Viajante interessado em explorar …".
      - interests is weak if it's empty or has < 3 items.
    Weak fields get replaced by a richer default that references the
    destination explicitly, so "Buenos Aires" never shows up as
    "Viajante interessado em explorar …" again.
    """
    GENERIC_STYLES = {"explorador", "traveler", "turista", "viajante", "explorer"}
    GENERIC_DESC_PREFIX = "Viajante interessado em explorar"

    style = (parsed.get("travel_style") or "").strip()
    if len(style.split()) < 3 or style.lower() in GENERIC_STYLES:
        parsed["travel_style"] = f"explorador urbano em {destination}" if destination else "explorador urbano"
        parsed.setdefault(
            "travel_style_en",
            f"urban explorer in {destination}" if destination else "urban explorer",
        )

    desc = (parsed.get("profile_description") or "").strip()
    if len(desc) < 30 or desc.startswith(GENERIC_DESC_PREFIX):
        parsed["profile_description"] = (
            f"Viajante com olhar curioso para {destination or 'o destino'}, "
            "combinando marcos icônicos com descobertas em bairros locais. "
            "O perfil valoriza um ritmo equilibrado — tempo para caminhar, "
            "experiências gastronômicas e momentos fotogênicos ao pôr do sol."
        )
        parsed.setdefault(
            "profile_description_en",
            (
                f"A curious traveler set on exploring {destination or 'the destination'}, "
                "mixing iconic landmarks with neighborhood discoveries. "
                "The profile favors a balanced pace — time to wander, "
                "culinary experiences, and photogenic sunset moments."
            ),
        )

    interests = parsed.get("interests") or []
    if not isinstance(interests, list) or len(interests) < 3:
        parsed["interests"] = [
            "pontos turísticos icônicos",
            "gastronomia local",
            "bairros com personalidade",
            "mirantes e pôr do sol",
            "cafés especiais",
        ]
        parsed.setdefault(
            "interests_en",
            [
                "iconic landmarks",
                "local gastronomy",
                "neighborhoods with character",
                "viewpoints and sunsets",
                "specialty cafés",
            ],
        )

    parsed.setdefault("pace", "moderado")
    parsed.setdefault(
        "cities_detected", [destination] if destination else []
    )
    parsed.setdefault("places_mentioned", [])


def _proportional_distribution(num_days: int, cities: list[str]) -> dict[str, int]:
    """Split num_days across cities proportionally; remainder goes to earlier ones.

    15 days / 4 cities → {c0: 4, c1: 4, c2: 4, c3: 3}. Preserves city order.
    Used as the initial distribution when a multi_base trip is detected, and
    as the legacy fallback in _assign_day_rigidity when the user hasn't yet
    confirmed a custom distribution.
    """
    valid = [c for c in cities if c and str(c).strip()]
    if not valid or num_days <= 0:
        return {}
    base = num_days // len(valid)
    rem = num_days % len(valid)
    return {c: base + (1 if i < rem else 0) for i, c in enumerate(valid)}


async def _assign_cities_to_days(
    rails: RailsClient, trip_id: int, day_plans: list[dict],
    day_distribution: dict[str, int],
):
    """Assign cities to day_plans based on user-chosen day distribution.

    day_distribution: {"Las Vegas": 3, "Zion National Park": 2, "Beryl": 2}
    """
    if not day_distribution:
        return

    # Build ordered city→days mapping from distribution
    day_index = 0
    for city, num_days in day_distribution.items():
        for _ in range(num_days):
            if day_index < len(day_plans):
                dp = day_plans[day_index]
                try:
                    await rails.update_day_plan(trip_id, dp["id"], {"city": city})
                    dp["city"] = city
                except Exception as e:
                    logger.warning("[cities] Failed to assign city to day %d: %s", dp["day_number"], e)
                day_index += 1


def _normalize_place_name(name: str) -> str:
    """Normalize a place name for fuzzy matching — strip accents, lowercase,
    remove punctuation and common noise words including multilingual connectors."""
    import unicodedata

    if not name:
        return ""
    # Strip accents
    n = unicodedata.normalize("NFD", name)
    n = "".join(c for c in n if unicodedata.category(c) != "Mn")
    n = n.lower().strip()
    # Remove punctuation and duplicate whitespace
    n = re.sub(r"[^a-z0-9\s]", " ", n)
    n = re.sub(r"\s+", " ", n).strip()
    # Remove multi-word connectors: "de la", "de los", "de las" (Spanish)
    # and Portuguese/English/French equivalents
    n = re.sub(r"\b(de la|de los|de las|del|do|da|dos|das|de|of the|of|du|de la|en el|en)\b", " ", n)
    n = re.sub(r"\s+", " ", n).strip()
    # Strip trailing city/state noise + common qualifiers
    noise_words = {
        "the", "a", "an", "o", "os", "as", "el", "la", "los", "las",
        "restaurant", "restaurante", "restaurante", "ristorante",
        "cafe", "cafeteria", "bar", "museu", "museum", "musee",
        "parque", "park", "parc", "statue", "estatua", "statua",
        "iglesia", "igreja", "church", "eglise",
        "praca", "plaza", "place", "square",
    }
    tokens = [t for t in n.split() if t and t not in noise_words]
    return " ".join(tokens) if tokens else n


def _deduplicate_places(place_list: list[dict]) -> list[dict]:
    """Remove duplicate places — same normalized name, same or adjacent day.
    Keeps the first occurrence (preserving order)."""
    if not place_list:
        return place_list

    seen: dict[str, dict] = {}
    result: list[dict] = []
    removed = 0

    for item in place_list:
        name = (item.get("name") or "").strip()
        if not name:
            continue
        norm = _normalize_place_name(name)
        if not norm:
            result.append(item)
            continue

        existing = seen.get(norm)
        if existing is None:
            seen[norm] = item
            result.append(item)
            continue

        # Same normalized name already exists — prefer the link-sourced one
        if item.get("source") == "link" and existing.get("source") != "link":
            # Replace the existing with this one (link takes priority)
            idx = result.index(existing)
            result[idx] = item
            seen[norm] = item
        # else: drop this duplicate
        removed += 1

    if removed:
        logger.info("[dedup] Removed %d duplicate place(s)", removed)
    return result


def _semantic_deduplicate(place_list: list[dict]) -> list[dict]:
    """Phase 3 — stronger dedup layered on top of _deduplicate_places.

    Three passes in order:

    1. Canonical alias resolution: "Cristo Redentor" + "Christ the Redeemer"
       map to the same canonical via LANDMARK_ALIASES. The item that survives
       is renamed to the canonical English form IF every variant seen came
       from AI (we don't rewrite link items — the user's video name wins).

    2. Geographic clustering: two items with different normalized names but
       coordinates within ~150m AND similar names (SequenceMatcher ratio ≥ 0.7)
       are treated as duplicates.

    3. The classic normalized-name pass (already handled by the caller —
       this function just adds the two layers above on top).

    Link-sourced items ALWAYS win over AI when a collision is found.
    """
    if not place_list:
        return place_list

    from app.data.landmark_aliases import ALIAS_INDEX
    from difflib import SequenceMatcher

    def _norm_alias(s: str) -> str:
        import unicodedata
        s = unicodedata.normalize("NFKD", s or "").encode("ASCII", "ignore").decode("ASCII")
        s = re.sub(r"[^a-z0-9\s]+", " ", s.lower())
        return re.sub(r"\s+", " ", s).strip()

    # Pass 1 — alias canonicalization.
    alias_groups: dict[str, list[dict]] = {}
    unrelated: list[dict] = []
    for item in place_list:
        name = (item.get("name") or "").strip()
        if not name:
            continue
        canonical = ALIAS_INDEX.get(_norm_alias(name))
        if canonical:
            alias_groups.setdefault(canonical, []).append(item)
        else:
            unrelated.append(item)

    deduped: list[dict] = []
    alias_removed = 0
    for canonical, items in alias_groups.items():
        if len(items) == 1:
            deduped.append(items[0])
            continue
        # Prefer link-sourced over AI. If multiple link items, keep the first.
        link_items = [i for i in items if i.get("source") == "link"]
        winner = link_items[0] if link_items else items[0]
        # When every item is AI, rewrite name to the canonical English form
        # for downstream consistency.
        if not link_items:
            winner["name"] = canonical
        deduped.append(winner)
        alias_removed += len(items) - 1

    deduped.extend(unrelated)

    # Pass 2 — geographic clustering within the already-once-deduped list.
    geo_removed = 0
    final: list[dict] = []
    for item in deduped:
        lat = item.get("latitude")
        lng = item.get("longitude")
        name = (item.get("name") or "").strip()
        if not lat or not lng or not name:
            final.append(item)
            continue
        is_dup = False
        for kept in final:
            klat = kept.get("latitude")
            klng = kept.get("longitude")
            kname = (kept.get("name") or "").strip()
            if not klat or not klng or not kname:
                continue
            try:
                dist_m = _haversine_km(float(lat), float(lng), float(klat), float(klng)) * 1000
            except (TypeError, ValueError):
                continue
            if dist_m > 150:
                continue
            sim = SequenceMatcher(None, _normalize_place_name(name), _normalize_place_name(kname)).ratio()
            if sim < 0.7:
                continue
            # Conflict. Link wins.
            if item.get("source") == "link" and kept.get("source") != "link":
                # Replace kept with item.
                final[final.index(kept)] = item
            # Otherwise keep `kept`.
            is_dup = True
            geo_removed += 1
            break
        if not is_dup:
            final.append(item)

    total_removed = alias_removed + geo_removed
    if total_removed:
        logger.info(
            "[dedup-semantic] alias_removed=%d geo_removed=%d total=%d",
            alias_removed, geo_removed, total_removed,
        )
    return final


def _final_itinerary_dedup(place_list: list[dict]) -> list[dict]:
    """Final dedup pass — runs AFTER Google Places validation when every
    surviving item has place_id + lat/lng. Catches collisions that the
    earlier name-based passes missed because they ran before coords
    existed (e.g. Sonnet output + safety-net injection both emitting
    "Casa Rosada" and both resolving to the same Place ID).

    Keys, in strictness order:
      1. google_place_id — strongest signal. Same place = same place.
      2. Normalized name within the same day.
      3. Lat/lng within 100m + similar name (ratio ≥ 0.7).

    When a collision is found, prefer source="link" over source="ai";
    when both are same source, keep the earlier item (stable order).
    """
    if not place_list:
        return place_list

    def _key_id(it: dict) -> str | None:
        pid = it.get("google_place_id") or it.get("place_id") or ""
        return pid.strip() or None

    # Pass A — dedup by google_place_id (globally across all days).
    by_id: dict[str, dict] = {}
    order: list[dict] = []
    removed_id = 0
    for item in place_list:
        pid = _key_id(item)
        if not pid:
            order.append(item)
            continue
        existing = by_id.get(pid)
        if existing is None:
            by_id[pid] = item
            order.append(item)
            continue
        # Collision — link beats ai; else keep the earlier one.
        if item.get("source") == "link" and existing.get("source") != "link":
            idx = order.index(existing)
            order[idx] = item
            by_id[pid] = item
        removed_id += 1

    # Pass B — dedup by (day, normalized_name).
    by_day_name: dict[tuple[int, str], dict] = {}
    filtered: list[dict] = []
    removed_name = 0
    for item in order:
        day = item.get("day")
        name = (item.get("name") or "").strip()
        if not name or not isinstance(day, int):
            filtered.append(item)
            continue
        norm = _normalize_place_name(name)
        if not norm:
            filtered.append(item)
            continue
        key = (day, norm)
        existing = by_day_name.get(key)
        if existing is None:
            by_day_name[key] = item
            filtered.append(item)
            continue
        if item.get("source") == "link" and existing.get("source") != "link":
            idx = filtered.index(existing)
            filtered[idx] = item
            by_day_name[key] = item
        removed_name += 1

    # Pass C — geographic collapse within the same day (100m + name ratio ≥0.7).
    final: list[dict] = []
    removed_geo = 0
    by_day_items: dict[int, list[dict]] = {}
    for item in filtered:
        day = item.get("day")
        if isinstance(day, int):
            by_day_items.setdefault(day, []).append(item)
        else:
            final.append(item)

    for day, items in by_day_items.items():
        kept: list[dict] = []
        for item in items:
            lat = item.get("latitude")
            lng = item.get("longitude")
            name = _normalize_place_name((item.get("name") or "").strip())
            if lat is None or lng is None or not name:
                kept.append(item)
                continue
            is_dup = False
            for k in kept:
                klat, klng = k.get("latitude"), k.get("longitude")
                kname = _normalize_place_name((k.get("name") or "").strip())
                if klat is None or klng is None or not kname:
                    continue
                try:
                    d_m = _haversine_km(float(lat), float(lng), float(klat), float(klng)) * 1000
                except (TypeError, ValueError):
                    continue
                if d_m > 100:
                    continue
                sim = SequenceMatcher(None, name, kname).ratio()
                if sim < 0.7:
                    continue
                # Duplicate — link beats ai.
                if item.get("source") == "link" and k.get("source") != "link":
                    idx = kept.index(k)
                    kept[idx] = item
                is_dup = True
                removed_geo += 1
                break
            if not is_dup:
                kept.append(item)
        final.extend(kept)

    total_removed = removed_id + removed_name + removed_geo
    if total_removed:
        logger.info(
            "[final-dedup] removed=%d (by_place_id=%d, by_name=%d, by_geo=%d)",
            total_removed, removed_id, removed_name, removed_geo,
        )
    return final


def _enforce_day_trip_isolation(place_list: list[dict]) -> list[dict]:
    """If a day contains a day-trip destination (e.g. Tigre Delta ~1h away
    from Buenos Aires), that day should NOT also have afternoon-Palermo
    items. Real travel agents don't mix a 8-hour round trip with urban
    city activities on the same day.

    Rules:
      - If ANY item on a day has item_role="day_trip_destination",
        activity_model="day_trip", OR duration_minutes >= 300, the day
        is marked as a day-trip day.
      - On a day-trip day, keep only the day-trip item(s) + items whose
        city matches the day-trip destination (e.g. a restaurant IN
        Tigre is fine on a Tigre day).
      - Everything else on that day is dropped (logged).

    Runs after final dedup so we don't waste checks on duplicates.
    """
    if not place_list:
        return place_list

    def _is_day_trip(item: dict) -> bool:
        role = str(item.get("item_role") or "").lower()
        model = str(item.get("activity_model") or "").lower()
        dur = item.get("duration_minutes") or 0
        try:
            dur = int(dur)
        except (TypeError, ValueError):
            dur = 0
        return (
            role == "day_trip_destination"
            or model == "day_trip"
            or dur >= 300
        )

    by_day: dict[int, list[dict]] = {}
    for item in place_list:
        d = item.get("day")
        if isinstance(d, int):
            by_day.setdefault(d, []).append(item)

    keep_ids: set[int] = set()
    dropped_names: list[tuple[int, str]] = []
    for day, items in by_day.items():
        day_trip_items = [i for i in items if _is_day_trip(i)]
        if not day_trip_items:
            for i in items:
                keep_ids.add(id(i))
            continue
        # This is a day-trip day. Figure out the destination city (the
        # strongest signal on the day-trip item itself).
        dt_city = ""
        for dt in day_trip_items:
            candidate = (
                (dt.get("city") or "").strip()
                or (dt.get("primary_region") or "").strip()
            )
            if candidate:
                dt_city = candidate.lower()
                break
        # Also parse from address as last resort.
        if not dt_city:
            for dt in day_trip_items:
                addr = (dt.get("address") or "").lower()
                for token in ("tigre", "versailles", "versalhes", "sintra", "colonia"):
                    if token in addr:
                        dt_city = token
                        break
                if dt_city:
                    break

        for i in items:
            if _is_day_trip(i):
                keep_ids.add(id(i))
                continue
            # Same city as the day trip? Allow.
            i_city = (
                (i.get("city") or "").strip().lower()
                or (i.get("primary_region") or "").strip().lower()
            )
            addr = (i.get("address") or "").lower()
            if dt_city and (dt_city in i_city or dt_city in addr):
                keep_ids.add(id(i))
                continue
            dropped_names.append((day, (i.get("name") or "?")))

    if dropped_names:
        logger.info(
            "[day-trip-isolation] dropped %d item(s) from day-trip days: %s",
            len(dropped_names),
            [f"day{d}:{n}" for d, n in dropped_names[:8]],
        )
    # Keep the original order, just filter.
    return [it for it in place_list if id(it) in keep_ids or not isinstance(it.get("day"), int)]


def _tag_sources_from_links(place_list: list[dict], places_mentioned: list[dict]) -> list[dict]:
    """Programmatically tag source='link' for items matching places_mentioned.

    Claude often ignores the source tagging instruction, so we do it ourselves
    by fuzzy-matching item names against the extracted places list.
    """
    if not places_mentioned:
        # Still ensure every item has a source set
        for item in place_list:
            if item.get("source") not in ("link", "ai", "manual"):
                item["source"] = "ai"
        return place_list

    # Build normalized name variants + their origin URL
    # Each entry: (normalized_name, original_name, source_url)
    link_variants: list[tuple[str, str, str | None]] = []
    for p in places_mentioned:
        name = (p.get("name") or "").strip()
        if name:
            link_variants.append((
                _normalize_place_name(name),
                name,
                p.get("source_url"),
            ))

    if not link_variants:
        return place_list

    def _mark_link(item: dict, source_url: str | None) -> None:
        item["source"] = "link"
        # Only set source_url if we know which link this place came from.
        # This ensures the frontend badge shows 'Do TikTok', 'Do Instagram',
        # etc. based on the actual origin URL, not a random concat.
        if source_url and not item.get("source_url"):
            item["source_url"] = source_url

    tagged_link = 0
    for item in place_list:
        raw = (item.get("name") or "").strip()
        if not raw:
            continue
        item_norm = _normalize_place_name(raw)
        if not item_norm:
            continue

        matched = False
        matched_url = None

        # 1. Exact normalized match
        for link_norm, _orig, url in link_variants:
            if item_norm == link_norm:
                matched = True
                matched_url = url
                break

        # 2. Containment (handles "Cristo Redentor Statue" ⊇ "Cristo Redentor")
        if not matched:
            for link_norm, _orig, url in link_variants:
                if not link_norm:
                    continue
                if (
                    link_norm in item_norm
                    or item_norm in link_norm
                    or _token_overlap(link_norm, item_norm) >= 0.7
                ):
                    matched = True
                    matched_url = url
                    break

        # 3. Sequence similarity fallback
        if not matched:
            for link_norm, _orig, url in link_variants:
                ratio = SequenceMatcher(None, item_norm, link_norm).ratio()
                if ratio >= 0.68:
                    matched = True
                    matched_url = url
                    break

        if matched:
            _mark_link(item, matched_url)
            tagged_link += 1
        elif item.get("source") != "link":
            item["source"] = "ai"
            item.pop("source_url", None)

    logger.info(
        "[source-tag] Tagged %d/%d items as 'link' (from %d places_mentioned)",
        tagged_link,
        len(place_list),
        len(link_variants),
    )
    return place_list


def _token_overlap(a: str, b: str) -> float:
    """Jaccard overlap on tokens — catches word-order differences.

    'observatorio griffith' vs 'griffith observatorio' → 1.0
    """
    sa = set(a.split())
    sb = set(b.split())
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / len(sa | sb)


def _ensure_link_places_present(
    place_list: list[dict],
    places_mentioned: list[dict] | None,
    day_plans: list[dict],
) -> list[dict]:
    """After Claude returns, verify every link-mentioned place is actually in
    the itinerary. If any are missing, inject them on an appropriate day.

    Match strategy (strictest first): exact-normalized match → high-similarity
    ratio (>=0.85) → token-overlap ≥ 75%. The old "substring either direction"
    check caused false positives ("Parque" matching "Parque de la Costa" and
    hiding a real drop), so it's been removed. False positives here = silently
    dropped places; false negatives = duplicate injection (caught by later
    dedup). Prefer false negatives.

    Logs every drop + every match decision so audits can verify "fidelidade
    ao vídeo é obrigatória" is actually holding.
    """
    if not places_mentioned:
        return place_list

    present_items: list[tuple[str, str]] = [
        (_normalize_place_name(it.get("name", "")), it.get("name", ""))
        for it in place_list
        if it.get("name")
    ]
    present_norms = {norm for norm, _ in present_items if norm}

    def _matches_existing(norm: str) -> str | None:
        """Return the name of a present item that matches, or None."""
        if not norm:
            return None
        if norm in present_norms:
            return norm
        # High-similarity fallback. 0.85 catches "Cemitério de la Recoleta"
        # vs "Cemitério da Recoleta" but rejects "Parque" vs "Parque de la
        # Costa" (ratio ~0.40).
        best_ratio = 0.0
        best_name: str | None = None
        for other_norm, other_name in present_items:
            if not other_norm:
                continue
            ratio = SequenceMatcher(None, norm, other_norm).ratio()
            if ratio > best_ratio:
                best_ratio = ratio
                best_name = other_name
        if best_ratio >= 0.85:
            return best_name
        # Token-overlap floor: handles reordered words like
        # "Museu de Arte Decorativa" vs "Arte Decorativa Museu".
        tokens_a = set(norm.split())
        if tokens_a:
            for other_norm, other_name in present_items:
                if not other_norm:
                    continue
                tokens_b = set(other_norm.split())
                if not tokens_b:
                    continue
                overlap = len(tokens_a & tokens_b) / max(
                    len(tokens_a), len(tokens_b),
                )
                if overlap >= 0.75:
                    return other_name
        return None

    missing: list[dict] = []
    matched: list[tuple[str, str]] = []
    for p in places_mentioned:
        name = (p.get("name") or "").strip()
        if not name:
            continue
        norm = _normalize_place_name(name)
        match = _matches_existing(norm)
        if match is None:
            missing.append(p)
        else:
            matched.append((name, match))

    logger.info(
        "[link-coverage] matched=%d dropped=%d total_mentioned=%d",
        len(matched), len(missing), len(places_mentioned),
    )
    if not missing:
        return place_list

    logger.warning(
        "[link-coverage] Claude DROPPED %d link place(s): %s — auto-injecting",
        len(missing),
        [p.get("name") for p in missing],
    )

    # Distribute missing places: prefer day suggested by extractor, else
    # the least-packed day, capped at 6 items per day.
    num_days = len(day_plans)
    items_per_day: dict[int, int] = {}
    for it in place_list:
        d = it.get("day") or 1
        items_per_day[d] = items_per_day.get(d, 0) + 1

    for p in missing:
        target_day = p.get("day") or None
        if not target_day or target_day < 1 or target_day > num_days:
            # Pick day with fewest items, avoiding days already full
            target_day = min(
                range(1, num_days + 1),
                key=lambda d: items_per_day.get(d, 0),
            )
        if items_per_day.get(target_day, 0) >= 6:
            # Day is full — pick any other under 6
            candidates = [
                d for d in range(1, num_days + 1)
                if items_per_day.get(d, 0) < 6
            ]
            if candidates:
                target_day = min(candidates, key=lambda d: items_per_day.get(d, 0))

        injected = {
            "day": target_day,
            "name": p.get("name"),
            "category": "attraction",
            "time_slot": "15:00",
            "duration_minutes": 90,
            "description": "Lugar mencionado no seu link salvo.",
            "notes": None,
            "vibe_tags": [],
            "alerts": [],
            "alternative_group": None,
            "source": "link",
            "source_url": p.get("source_url"),
        }
        place_list.append(injected)
        items_per_day[target_day] = items_per_day.get(target_day, 0) + 1
        logger.info(
            "[link-coverage] Injected '%s' on day %d", p.get("name"), target_day
        )

    return place_list


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate distance in km between two lat/lng points using Haversine formula."""
    R = 6371  # Earth's radius in km
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    return R * 2 * math.asin(math.sqrt(a))


def _compute_centroid(places: list[dict]) -> tuple[float, float] | None:
    """Average lat/lng of geocoded places. None if no geocoded place."""
    lats, lngs = [], []
    for p in places:
        lat, lng = p.get("latitude"), p.get("longitude")
        if lat is None or lng is None:
            continue
        try:
            lats.append(float(lat))
            lngs.append(float(lng))
        except (ValueError, TypeError):
            continue
    if not lats:
        return None
    return (sum(lats) / len(lats), sum(lngs) / len(lngs))


def _cluster_diameter_km(places: list[dict]) -> float:
    """Max distance between any two geocoded places in the group."""
    coords = []
    for p in places:
        lat, lng = p.get("latitude"), p.get("longitude")
        if lat is None or lng is None:
            continue
        try:
            coords.append((float(lat), float(lng)))
        except (ValueError, TypeError):
            continue
    if len(coords) < 2:
        return 0.0
    max_d = 0.0
    for i in range(len(coords)):
        for j in range(i + 1, len(coords)):
            d = _haversine_km(
                coords[i][0], coords[i][1], coords[j][0], coords[j][1]
            )
            if d > max_d:
                max_d = d
    return max_d


def _tighten_day_clusters(
    place_list: list[dict],
    max_diameter_km: float = 15.0,
    day_rigidity: dict[int, str] | None = None,
) -> list[dict]:
    """Enforce that every day's places sit within max_diameter_km of each
    other. If a day has an outlier, try to move it to another day whose
    cluster already contains nearby places. If no such day exists, drop it.

    This handles both regular urban days (~10km diameter) AND day trips
    (all places clustered in the remote zone — Tigre, Campanópolis etc.).
    The rule is NOT 'stay close to city center' — it is 'stay close to the
    rest of YOUR day'.

    Runs iteratively: each pass drops at most one outlier per day so that
    removing an outlier recomputes the centroid before dropping the next.

    Phase 3: `day_rigidity` — locked days are SKIPPED entirely (their layout
    is the video's intent, even if it looks geographically sparse). Outliers
    from flexible days also can't be moved INTO a locked day.
    """
    if not place_list:
        return place_list

    day_rigidity = day_rigidity or {}

    by_day: dict[int, list[dict]] = {}
    order: list[int] = []
    for p in place_list:
        d = p.get("day") or 1
        if d not in by_day:
            order.append(d)
        by_day.setdefault(d, []).append(p)

    dropped_total = 0
    moved_total = 0

    # Iterate until no day has a diameter violation (max 6 passes — safety)
    for _ in range(6):
        changes = False
        for day in list(by_day.keys()):
            # Locked days are sacred — skip.
            if day_rigidity.get(day) == "locked":
                continue
            places = by_day[day]
            geocoded = [
                p for p in places
                if p.get("latitude") is not None and p.get("longitude") is not None
            ]
            if len(geocoded) < 3:
                continue

            diameter = _cluster_diameter_km(geocoded)
            if diameter <= max_diameter_km:
                continue

            # Find the place furthest from the centroid — that's the outlier.
            # Skip places already flagged for user review (prevents infinite loop).
            centroid = _compute_centroid(geocoded)
            if centroid is None:
                continue
            c_lat, c_lng = centroid
            outlier = None
            outlier_dist = 0.0
            for p in geocoded:
                if p.get("_review_flagged"):
                    continue
                try:
                    dist = _haversine_km(
                        c_lat, c_lng, float(p["latitude"]), float(p["longitude"])
                    )
                except (ValueError, TypeError):
                    continue
                if dist > outlier_dist:
                    outlier_dist = dist
                    outlier = p

            if outlier is None:
                continue

            # Try to relocate the outlier to a day whose centroid is within
            # max_diameter_km of the outlier's position. NEVER target a
            # locked day — its composition was set by the video.
            o_lat = float(outlier["latitude"])
            o_lng = float(outlier["longitude"])
            best_day = None
            best_dist = max_diameter_km
            for other_day, other_places in by_day.items():
                if other_day == day:
                    continue
                if day_rigidity.get(other_day) == "locked":
                    continue
                other_geocoded = [
                    p for p in other_places
                    if p.get("latitude") is not None
                    and p.get("longitude") is not None
                ]
                if not other_geocoded or len(other_places) >= 6:
                    continue
                other_centroid = _compute_centroid(other_geocoded)
                if other_centroid is None:
                    continue
                d = _haversine_km(
                    other_centroid[0], other_centroid[1], o_lat, o_lng
                )
                if d < best_dist:
                    best_dist = d
                    best_day = other_day

            is_from_link = outlier.get("source") == "link"

            if best_day is not None:
                outlier["day"] = best_day
                by_day[day].remove(outlier)
                by_day[best_day].append(outlier)
                moved_total += 1
                logger.info(
                    "[geo] Moved '%s' from day %d to day %d (%.0fkm to new cluster)",
                    outlier.get("name"), day, best_day, best_dist,
                )
            elif is_from_link:
                # LINK PLACE with no compatible day — do NOT drop. Flag it
                # so the user can decide. The creator of the video mentioned
                # this place, so it deserves user review, not silent removal.
                outlier["needs_review"] = True
                outlier["review_reason"] = "far_from_day_cluster"
                outlier["review_distance_km"] = round(outlier_dist, 1)
                outlier["review_day"] = day
                alerts = list(outlier.get("alerts") or [])
                warn = (
                    f"⚠️ Este lugar fica a {round(outlier_dist)}km do resto "
                    f"do Dia {day}. Como veio do seu link, deixamos aqui para "
                    f"você decidir: manter (e trocar de dia manualmente) ou "
                    f"remover do roteiro."
                )
                if not any("⚠️" in a for a in alerts):
                    alerts.append(warn)
                outlier["alerts"] = alerts
                logger.info(
                    "[geo] FLAGGED link-sourced outlier '%s' (day %d, %.0fkm) for user review",
                    outlier.get("name"), day, outlier_dist,
                )
                # Don't re-process this outlier — mark as reviewed to break loop
                outlier["_review_flagged"] = True
            else:
                by_day[day].remove(outlier)
                dropped_total += 1
                logger.warning(
                    "[geo] DROPPED outlier '%s' (day %d): %.0fkm from day centroid, no compatible day found",
                    outlier.get("name"), day, outlier_dist,
                )

            changes = True

        if not changes:
            break

    if moved_total or dropped_total:
        logger.warning(
            "[geo] Cluster tightening: moved=%d, dropped=%d (diameter threshold %dkm)",
            moved_total, dropped_total, int(max_diameter_km),
        )

    # Flatten back preserving original day order and strip internal flags
    result: list[dict] = []
    for d in order:
        for p in by_day.get(d, []):
            p.pop("_review_flagged", None)
            result.append(p)
    for d in by_day:
        if d not in order:
            for p in by_day[d]:
                p.pop("_review_flagged", None)
                result.append(p)
    return result


async def _get_destination_coords(destination: str, places_client: GooglePlacesClient) -> tuple[float, float] | None:
    """Get lat/lng for the trip destination using Google Places."""
    if not destination:
        return None
    try:
        results = await places_client.search(destination, destination)
        if results:
            lat = results[0].get("latitude")
            lng = results[0].get("longitude")
            if lat and lng:
                return (float(lat), float(lng))
    except Exception as e:
        logger.warning("[geo] Failed to geocode destination '%s': %s", destination, e)
    return None


# Global semaphore for Haiku experience_recommendations to respect
# Anthropic's org-level rate limit (50 req/min on Haiku 4.5). On a
# 15-day multi-base trip we previously fired 30+ concurrent calls and
# got 429-stormed — half the items ended up with empty recommendations.
# Concurrency of 4 keeps us under the limit even with bursts while still
# processing a full trip in ~5-10s.
_HAIKU_REC_SEMAPHORE = asyncio.Semaphore(4)


async def _experience_recommendations(
    experience_name: str, destination: str, cost: CostTracker,
) -> list[dict]:
    """Ask Haiku for 2-3 specific venues/companies that offer this experience
    in the destination. Used when `_looks_like_experience(name)` is True so
    the itinerary card has concrete, bookable recommendations instead of a
    vague "show de tango" line with no where-to-go.

    Returns a list of `{name, note}` dicts (empty on failure — the card still
    renders, it just won't have the "💡 Onde fazer" line).

    Rate-limited via a global semaphore so parallel calls from
    _validate_and_create_items never burst past Anthropic's 50 req/min cap.
    """
    if not experience_name or not destination:
        return []

    prompt = (
        f'Para a experiência "{experience_name}" em {destination}, '
        f"liste os TOP 3 LUGARES MAIS FAMOSOS — os nomes que TODO mundo "
        f"reconhece, aqueles que aparecem em guias sérios e rankings.\n\n"
        f"Pense: se um amigo argentino/local me recomendasse onde fazer isso, "
        f"quais seriam os 3 nomes que ele CERTAMENTE mencionaria? "
        f"Os clássicos imperdíveis — NÃO os mais fáceis de lembrar.\n\n"
        "Exemplos do nível de fama esperado:\n"
        '- Show de tango em Buenos Aires → "Señor Tango", "Piazzolla Tango", "El Viejo Almacén"\n'
        '- Passeio de barco em Capri → "Laser Capri", "Motoscafisti Capri", "Gianni\'s Boat"\n'
        '- Food tour em Roma → "Eating Europe", "Devour Tours", "The Roman Guy"\n'
        '- Buggy em Jericoacoara → "Jeri Off Road", "Dunas Tour", "Jericoacoara Adventures"\n\n'
        "Responda APENAS JSON (sem markdown, sem comentário):\n"
        '[{"name": "Nome real do local/empresa", "note": "1 linha em pt-BR sobre o diferencial (estilo, preço, vibe) — máx 60 chars"}]\n\n'
        "REGRAS:\n"
        "- EXATAMENTE 3 opções quando existirem lugares famosos.\n"
        "- Ordene da MAIS famosa (posição 0) para a menos famosa.\n"
        "- `name` deve ser o nome OFICIAL conforme aparece no Google.\n"
        "- Se houver menos de 3 lugares realmente reconhecidos, retorne só 1 ou 2.\n"
        "- Se não conhece opções concretas em " + destination + ", retorne []."
    )

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key, max_retries=1)
    async with _HAIKU_REC_SEMAPHORE:
        try:
            response = await asyncio.wait_for(
                asyncio.to_thread(
                    lambda: client.messages.create(
                        model="claude-haiku-4-5-20251001",
                        max_tokens=500,
                        messages=[{"role": "user", "content": prompt}],
                        timeout=15.0,
                    )
                ),
                timeout=20.0,
            )
            cost.record_usage(response.usage)
            raw = response.content[0].text if response.content else "[]"
        except Exception as e:
            logger.warning(
                "[experience-rec] Haiku failed for %r in %s: %s",
                experience_name, destination, e,
            )
            return []

    parsed = _parse_json_response(raw)
    if not isinstance(parsed, list):
        return []
    out: list[dict] = []
    for item in parsed[:3]:
        if isinstance(item, dict) and item.get("name"):
            out.append({
                "name": str(item["name"])[:80],
                "note": str(item.get("note") or "")[:80],
            })
    logger.info(
        "[experience-rec] %r in %s → %d recs",
        experience_name, destination, len(out),
    )
    return out


async def _validate_and_create_items(
    place_list: list[dict],
    trip: dict,
    day_plans: list[dict],
    rails: RailsClient,
    places: GooglePlacesClient,
    cost: CostTracker,
    trip_id: int,
    source_urls: list[str] | None = None,
    day_rigidity: dict[int, str] | None = None,
) -> dict:
    """Validate places via Google Places, generate alerts, create items in Rails.

    Phase 3: propagates `day_rigidity` to `_tighten_day_clusters` and
    `_optimize_day_proximity` so locked days are never reordered or
    reshuffled by geographic heuristics.
    """
    day_rigidity = day_rigidity or {}
    dp_by_number = {dp["day_number"]: dp["id"] for dp in day_plans}
    # day_num → city map, built from _assign_day_rigidity's in-memory
    # mutations. Propagated onto each place BEFORE Google Places search so
    # a Phuket place on day 10 searches "... Phuket, Thailand" instead of
    # "... Bangkok, Thailand" and geolocates within 120km of Phuket, not
    # 700km outside the Bangkok fence.
    city_by_day: dict[int, str] = {
        dp["day_number"]: dp["city"]
        for dp in day_plans
        if dp.get("day_number") is not None and dp.get("city")
    }
    destination = trip.get("destination", "")
    source_url = ", ".join(source_urls) if source_urls else ""

    # Get destination center for geographic validation.
    # The fence here is the OUTER bound for "same trip" — day trips to
    # remote attractions (Tigre 30km, Campanópolis 50km) must fit.
    # The REAL logistic enforcement happens in _tighten_day_clusters:
    # a place can be 100km from city center, but it must be within 15km
    # of every other place ON THE SAME DAY.
    #
    # CRITICAL: the country is pulled from the AI-inferred profile
    # (country_detected) because the user-facing `destination` field can
    # be ambiguous or wrong (e.g., "Tailandia" is a town in Pará, Brazil
    # — NOT Thailand). Every Google Places query gets anchored with this
    # country name, and results from other countries are hard-rejected.
    profile_for_geo = trip.get("traveler_profile") or {}
    country_hint = (profile_for_geo.get("country_detected") or "").strip()
    # If the country hint fails to come through, synthesize one from the
    # destination field as a last-resort fallback.
    if not country_hint and destination:
        # Very rough heuristic — destinations usually end in ", Country"
        if "," in destination:
            country_hint = destination.split(",")[-1].strip()
    logger.info(
        "[geo] Using country='%s' for destination='%s'",
        country_hint, destination,
    )

    # Lower-case country tokens used for address-based rejection. We use
    # substring match on formatted_address because Google returns country
    # as the last segment (e.g., "... , Thailand").
    country_match_tokens: set[str] = set()
    if country_hint:
        country_match_tokens.add(country_hint.lower())
        # Common pt-BR ↔ en aliases so queries and addresses align.
        aliases = {
            "thailand": {"tailandia", "tailândia"},
            "italy": {"italia", "itália"},
            "france": {"franca", "frança"},
            "japan": {"japao", "japão"},
            "germany": {"alemanha"},
            "spain": {"espanha"},
            "switzerland": {"suica", "suíça"},
            "greece": {"grecia", "grécia"},
            "egypt": {"egito"},
            "morocco": {"marrocos"},
            "netherlands": {"holanda"},
            "united states": {"eua", "estados unidos", "usa"},
            "united kingdom": {"reino unido", "uk"},
        }
        for canonical, variants in aliases.items():
            if country_hint.lower() == canonical or country_hint.lower() in variants:
                country_match_tokens.add(canonical)
                country_match_tokens.update(variants)

    # Resolve destination coords using country-anchored search so
    # "Bangkok" disambiguates correctly from "Bangkok, Brazil" etc.
    geo_query = f"{destination}, {country_hint}" if (destination and country_hint and country_hint.lower() not in destination.lower()) else destination
    dest_coords = await _get_destination_coords(geo_query, places)
    if not dest_coords and country_hint:
        # Fall back to country-only geocoding so we at least know the
        # hemisphere + can reject obvious cross-country matches.
        dest_coords = await _get_destination_coords(country_hint, places)

    cities_in_plans = set()
    for dp in day_plans:
        c = dp.get("city")
        if c:
            cities_in_plans.add(c)
    # Multi-base trips legitimately span cities 800+ km apart (e.g. Thailand
    # with Bangkok + Phuket + Koh Lipe 819km away, or Italy Rome → Milan).
    # Per-day cluster tightening (15km diameter in _tighten_day_clusters)
    # handles the tight grouping — the fence only needs to prevent
    # cross-country false matches (Thailand → Miami's "Wat Pho" restaurant).
    # Thresholds tuned to real archetypes:
    #   - 1 city      → 120km (walkable + day trips to Tigre/Sintra/etc)
    #   - 2 cities    → 500km (Rome-Florence, BA-Rio de Janeiro)
    #   - 3+ cities   → 1500km (Thailand, Japan Tokyo→Osaka→Kyoto, etc)
    if len(cities_in_plans) >= 3:
        max_distance_km = 1500
    elif len(cities_in_plans) == 2:
        max_distance_km = 500
    else:
        max_distance_km = 120
    # Country-only fallback fence is looser — a country like Thailand is
    # ~1600km wide. Keep it sane but bigger than a city fence.
    if dest_coords and not (destination or "").strip():
        max_distance_km = 1500
    # Also widen the fence whenever the profile says multi_base, even if
    # day_plans haven't yet propagated city names (defensive — covers the
    # race where cities_in_plans is empty but we know it's a multi-city trip).
    _profile_dc = (trip.get("traveler_profile") or {}).get("destination_classification") or {}
    if _profile_dc.get("destination_type") == "multi_base" and max_distance_km < 1500:
        max_distance_km = 1500
    logger.info(
        "[geo] max_distance_km=%d (cities_in_plans=%d, dest_type=%s)",
        max_distance_km, len(cities_in_plans),
        _profile_dc.get("destination_type") or "-",
    )

    semaphore = asyncio.Semaphore(10)

    def _address_matches_country(address: str) -> bool:
        """Return True if we're confident this address is in the target
        country. Used to hard-reject wrong-country Google Places matches
        (e.g., a Thailand 'Wat Pho' search returning a Miami restaurant).
        If no country hint is available, we don't reject — just log.
        """
        if not country_match_tokens:
            return True
        if not address:
            return False
        low = address.lower()
        return any(tok in low for tok in country_match_tokens)

    async def _enrich_from_result(place: dict, best: dict) -> dict:
        """Copy Google Places search result fields onto the place dict."""
        place_id = best.get("place_id")
        place["latitude"] = best.get("latitude")
        place["longitude"] = best.get("longitude")
        place["address"] = best.get("address")
        place["google_place_id"] = place_id
        place["google_rating"] = best.get("rating")
        place["google_reviews_count"] = best.get("user_ratings_total")

        if place_id:
            details = await places.get_details(place_id)
            if details:
                place["phone"] = details.get("phone")
                place["website"] = details.get("website")
                place["pricing_info"] = details.get("pricing")
                place["operating_hours"] = details.get("operating_hours")
                place["google_reviews_count"] = details.get("reviews_count")
                photos = details.get("photos", [])
                if photos:
                    place["photos"] = photos[:2]
        return place

    async def _search_with_geo_check(
        place: dict, query: str, search_city: str
    ) -> dict | None:
        """Run Google Places search and return best result that (a) sits
        within max_distance_km of the trip's destination center AND (b) has
        a formatted_address in the expected country. Falls through to the
        next candidate when either check fails.

        Every query is augmented with the country hint when available so
        searching for 'Wat Pho' on a Thailand trip returns the Bangkok
        temple, not a coincidentally-named business in Miami.
        """
        # Inject country into the query when not already there. Google
        # accepts it as a disambiguation hint.
        augmented_query = query
        if country_hint and country_hint.lower() not in query.lower():
            augmented_query = f"{query}, {country_hint}"
        try:
            results = await places.search(augmented_query, search_city)
        except Exception as e:
            logger.warning("[eco] search failed for %s: %s", augmented_query, e)
            return None
        if not results:
            return None

        dest_lat, dest_lng = dest_coords if dest_coords else (None, None)

        for candidate in results[:5]:
            lat = candidate.get("latitude")
            lng = candidate.get("longitude")
            address = candidate.get("address") or ""

            # Country sanity check via address. This is cheap and catches
            # the "Thailand → Miami" class of failure instantly.
            if country_match_tokens and not _address_matches_country(address):
                logger.warning(
                    "[geo] Rejecting '%s' → '%s' (wrong country, expected %s)",
                    place.get("name"), address[:80], country_hint,
                )
                continue

            if lat is None or lng is None:
                continue

            # Distance fence (only if we have trip coords to compare against).
            if dest_lat is not None and dest_lng is not None:
                try:
                    dist = _haversine_km(dest_lat, dest_lng, float(lat), float(lng))
                except (ValueError, TypeError):
                    continue
                if dist > max_distance_km:
                    logger.warning(
                        "[geo] '%s' too far (%.0fkm > %dkm cap)",
                        place.get("name"), dist, max_distance_km,
                    )
                    continue
                if dist > 30:
                    logger.info(
                        "[geo] '%s' matched at %.0fkm — far but within fence",
                        place.get("name"), dist,
                    )

            return await _enrich_from_result(place, candidate)

        # No candidate passed both country + distance checks.
        logger.warning(
            "[geo] No valid match for '%s' after filtering %d candidates",
            place.get("name"), len(results),
        )
        return None

    async def validate_one(place: dict) -> dict | None:
        name = place.get("name", "")
        if not name:
            return None

        # Experiences (show de tango, passeio de barco, food tour, etc.)
        # don't map to a single lat/long — skip Google Places entirely and
        # emit 2-3 venue recommendations so the card is useful.
        if place.get("_is_experience") or _looks_like_experience(name):
            recs = await _experience_recommendations(name, destination, cost)
            place["category"] = place.get("category") or "activity"
            vibes = list(place.get("vibe_tags") or [])
            if "experiencia" not in vibes:
                vibes.append("experiencia")
            place["vibe_tags"] = vibes
            if recs:
                # Format nicely into the notes field so existing frontend
                # rendering shows the recommendations immediately.
                place["notes"] = (place.get("notes") or "").strip()
                place["notes"] += (
                    ("\n\n" if place["notes"] else "")
                    + "💡 Onde fazer: "
                    + " · ".join(r["name"] for r in recs[:3])
                )
                # Keep structured list too for future UI work.
                place["experience_recommendations"] = recs
            place.pop("_is_experience", None)
            place.pop("_out_of_fence", None)
            return place

        # Propagate day_plan.city onto the place so multi_base trips
        # search the CORRECT city (Phuket/Koh Lipe/Chiang Mai, not the
        # trip's primary destination which may be a different city).
        day_num_hint = place.get("day")
        if (
            (not place.get("city"))
            and isinstance(day_num_hint, int)
            and city_by_day.get(day_num_hint)
        ):
            place["city"] = city_by_day[day_num_hint]

        search_city = place.get("city") or destination
        async with semaphore:
            # Primary search — name + city
            enriched = await _search_with_geo_check(
                place, f"{name} {search_city}", search_city
            )
            if enriched:
                return enriched
            # Retry with explicit destination — catches ambiguous names
            # (e.g. "Palacio X" could exist in multiple Argentine towns;
            # adding "Buenos Aires, Argentina" pulls the BA match).
            if destination and search_city != destination:
                enriched = await _search_with_geo_check(
                    place, f"{name} {destination}", destination
                )
                if enriched:
                    return enriched
            # Last try — broader query
            enriched = await _search_with_geo_check(
                place, name, search_city or destination
            )
            if enriched:
                return enriched

            # Nothing within fence — Google Places couldn't match this name
            # to a geocodable location. Instead of dropping (old behaviour)
            # we treat it as an experience: keep the card, get venue
            # recommendations from Haiku, and tag it visually. This catches
            # the "barco bar Humberto M" / "show de tango em Palermo" /
            # "degustação no Mercado San Telmo" class of items that ARE
            # real things the creator recommended but Google doesn't know
            # about as a single POI.
            logger.warning(
                "[geo] Could not find '%s' within %dkm of %s — "
                "keeping as experience with venue recommendations",
                name, max_distance_km, destination,
            )
            place.pop("latitude", None)
            place.pop("longitude", None)
            recs = await _experience_recommendations(name, destination, cost)
            place["category"] = "activity"
            vibes = list(place.get("vibe_tags") or [])
            if "experiencia" not in vibes:
                vibes.append("experiencia")
            place["vibe_tags"] = vibes
            if recs:
                place["notes"] = (place.get("notes") or "").strip()
                place["notes"] += (
                    ("\n\n" if place["notes"] else "")
                    + "💡 Onde fazer: "
                    + " · ".join(r["name"] for r in recs[:3])
                )
                place["experience_recommendations"] = recs
            return place

    validated = await asyncio.gather(*[validate_one(p) for p in place_list])
    validated = [p for p in validated if p is not None]

    # Drop places that could not be located inside the fence.
    before = len(validated)
    validated = [p for p in validated if not p.get("_out_of_fence")]
    if before != len(validated):
        logger.warning(
            "[geo] Dropped %d out-of-fence places (>%dkm from %s)",
            before - len(validated), max_distance_km, destination,
        )

    # Per-day cluster tightening — enforce that every day's places sit
    # within a 15km diameter of each other. Outliers are first tried on
    # other days (to preserve day-trip places together), then dropped if
    # no compatible day exists.
    validated = _tighten_day_clusters(
        validated, max_diameter_km=15.0, day_rigidity=day_rigidity,
    )

    # Regra #1 — enforce Day 1 + Day 2 stay in the main destination city.
    # A day trip that landed on Day 1/2 (because the Sonnet output ignored
    # the rule) gets swapped with the latest Day 3+ that sits in the main
    # cluster. Skipped when the video explicitly placed it there.
    profile_hint = (trip.get("traveler_profile") or {})
    preplanned_day_places: dict[int, set[str]] = {}
    for dp_link in profile_hint.get("day_plans_from_links") or []:
        d = dp_link.get("day")
        pl = dp_link.get("places") or []
        if isinstance(d, int) and pl:
            preplanned_day_places[d] = set(pl)
    # Also seed preplanned_day_places from content_classification canonical_days
    # (which Phase 2 produces). Used so a video-locked day can't be swapped.
    cc = profile_hint.get("content_classification") or {}
    for k, v in (cc.get("canonical_days") or {}).items():
        try:
            day_key = int(k)
        except (TypeError, ValueError):
            continue
        if isinstance(v, dict) and v.get("places"):
            preplanned_day_places.setdefault(day_key, set()).update(v["places"])
    validated = _enforce_main_city_on_early_days(
        validated, len(day_plans), preplanned_day_places=preplanned_day_places,
    )

    # Generate deterministic alerts from Google Places data (zero AI cost)
    for place in validated:
        alerts = list(place.get("alerts") or [])
        hours = place.get("operating_hours")
        if hours and isinstance(hours, dict):
            closed_days = [d for d, h in hours.items() if "closed" in str(h).lower()]
            for d in closed_days:
                alert = f"Fechado: {d}"
                if alert not in alerts:
                    alerts.append(alert)
        pricing = place.get("pricing_info")
        if pricing in ("$$$$",):
            alert = "Local de alto custo"
            if alert not in alerts:
                alerts.append(alert)
        place["alerts"] = alerts

    # PROXIMITY OPTIMIZATION — reorder items within each day by geographic proximity.
    # Locked days retain the video's order (preserved by _optimize_day_proximity).
    validated = _optimize_day_proximity(validated, day_rigidity=day_rigidity)

    # FINAL DEDUP — now that Google Places has populated place_id + lat/lng,
    # run a stricter dedup pass. The earlier name-based dedup in
    # _deduplicate_places / _semantic_deduplicate ran BEFORE validation so
    # most items had no coords — that pass catches name-variants but misses
    # the case where Sonnet emits "Casa Rosada" and safety-net injects
    # "Casa Rosada" independently on a different day. Here we know the real
    # Google Place and can collapse the two.
    validated = _final_itinerary_dedup(validated)

    # DAY-TRIP ISOLATION — a real travel agent would never mix a Tigre day
    # trip (8h round-trip from Buenos Aires) with "afternoon Palermo
    # bars". Any item marked as a day-trip destination (item_role, activity_model,
    # or duration_minutes >= 300) takes over the full day; other items on
    # that day are dropped (with a log so we can tune).
    validated = _enforce_day_trip_isolation(validated)

    # EMPTY-DAY GUARD — the geo-cluster tightening + final dedup + day-trip
    # isolation together can leave a flexible day with 0 items (e.g. day 4
    # of a Buenos Aires trip lost Barrio Chino + Barco Humb to day 5 and
    # 2 duplicates were collapsed). A real planner would NEVER hand back
    # an empty day. Detect it here and re-fill with a Sonnet call —
    # preferring a structured day-trip (Tigre, Versalhes, Sintra…) when
    # the destination is well-known for them, otherwise a coherent
    # neighborhood-themed day from the existing flex research snippets.
    validated = await _fill_empty_days_after_cleanup(
        validated,
        day_plans=day_plans,
        trip=trip,
        cost=cost,
        places=places,
    )

    logger.info("[eco] Validated %d places, creating items", len(validated))

    # Create items in Rails (parallel for speed)
    day_positions: dict[int, int] = {}
    create_tasks = []

    VALID_CATEGORIES = {"restaurant", "attraction", "hotel", "transport", "activity", "shopping", "cafe", "nightlife", "other"}
    CATEGORY_MAP = {"bar": "nightlife", "park": "attraction", "museum": "attraction"}

    for place in validated:
        day_num = place.get("day", 1)
        day_plan_id = dp_by_number.get(day_num, list(dp_by_number.values())[0])

        pos = day_positions.get(day_plan_id, 0)
        day_positions[day_plan_id] = pos + 1

        raw_cat = place.get("category", "attraction")
        category = CATEGORY_MAP.get(raw_cat, raw_cat) if raw_cat not in VALID_CATEGORIES else raw_cat

        # source_url: ONLY link-sourced items keep a source URL. AI-added
        # places must not carry a URL (otherwise the frontend badge thinks
        # they came from the video).
        place_source = place.get("source", "ai")
        if place_source == "link":
            # Prefer the item-specific source_url if Claude / ensure_link
            # recorded one; fall back to the single-source URL of the trip.
            item_source_url = place.get("source_url") or (
                source_urls[0] if source_urls and len(source_urls) == 1 else None
            )
        else:
            item_source_url = None

        # Camada 4 — validate the two new enum fields before Rails sees them.
        # Rails will reject anything outside ACTIVITY_MODELS/VISIT_MODES so
        # we default rather than blow up the whole build.
        VALID_AMODELS = {
            "direct_place", "anchored_experience", "guided_excursion",
            "route_cluster", "day_trip", "transfer",
        }
        VALID_VMODES = {"self_guided", "guided", "book_separately", "operator_based"}
        amodel = place.get("activity_model")
        if amodel not in VALID_AMODELS:
            amodel = None  # let Rails store NULL; UI treats missing as direct_place
        vmode = place.get("visit_mode")
        if vmode not in VALID_VMODES:
            vmode = None

        item_data = {
            "name": place.get("name", "Unknown"),
            "category": category,
            "time_slot": place.get("time_slot"),
            "duration_minutes": place.get("duration_minutes"),
            "description": place.get("description", ""),
            "notes": place.get("notes"),
            "latitude": place.get("latitude"),
            "longitude": place.get("longitude"),
            "address": place.get("address"),
            "google_place_id": place.get("google_place_id"),
            "google_rating": place.get("google_rating"),
            "google_reviews_count": place.get("google_reviews_count"),
            "operating_hours": place.get("operating_hours"),
            "pricing_info": place.get("pricing_info"),
            "phone": place.get("phone"),
            "website": place.get("website"),
            "photos": place.get("photos"),
            "vibe_tags": place.get("vibe_tags"),
            "alerts": place.get("alerts"),
            "alternative_group": place.get("alternative_group"),
            "position": pos,
            "source": place_source,
            "source_url": item_source_url,
            # Camada 4 — new planning-model fields.
            "activity_model": amodel,
            "visit_mode": vmode,
            # STEP 2 — computed semantic role from activity_model + category
            # + vibe_tags + name. Rails-side enum validation will coerce
            # invalid values to null.
            "item_role": _compute_item_role({
                "activity_model": amodel,
                "category": category,
                "vibe_tags": place.get("vibe_tags") or [],
                "name": place.get("name") or "",
            }),
        }
        item_data = {k: v for k, v in item_data.items() if v is not None}
        create_tasks.append((trip_id, day_plan_id, item_data, place.get("name")))

    # Run all creates concurrently (batches of 10 to avoid overwhelming Rails)
    created = 0
    for i in range(0, len(create_tasks), 10):
        batch = create_tasks[i:i + 10]

        async def _create_one(t_id, dp_id, data, name):
            try:
                await rails.create_itinerary_item(t_id, dp_id, data)
                return True
            except Exception as e:
                logger.warning("[eco] Failed to create %s: %s", name, e)
                return False

        results = await asyncio.gather(
            *[_create_one(t, d, data, n) for t, d, data, n in batch]
        )
        created += sum(1 for r in results if r)

    cost.log_summary()
    return {
        "places_created": created,
        "summary": f"Created {created} items across {len(day_positions)} days",
        "cost": cost.summary(),
    }


def _build_itinerary_prompt(
    content_text: str,
    trip: dict,
    day_plans: list[dict],
    existing_items: list[str],
    source_urls: list[str] | None = None,
    places_mentioned: list[dict] | None = None,
    day_plans_from_links: list[dict] | None = None,
    canonical_days: dict[int, dict] | None = None,
    day_rigidity: dict[int, str] | None = None,
) -> str:
    """Build the Claude prompt for itinerary generation (Eco mode), with full personalization.

    Phase 3: when `canonical_days` is supplied (from the content classifier),
    an authoritative "RIGIDITY TABLE" block is emitted at the very top of the
    prompt listing each day's status. Locked days ship with their exact
    place list from the video — Claude is told not to reorder them.
    """
    num_days = len(day_plans)
    destination = trip.get("destination", "a destination")
    existing_info = f"\nAvoid duplicates: {', '.join(existing_items)}" if existing_items else ""
    canonical_days = canonical_days or {}
    day_rigidity = day_rigidity or {}

    # Personalization from traveler profile
    profile = trip.get("traveler_profile") or {}
    profile_section = ""
    if profile.get("travel_style") or profile.get("interests"):
        style = profile.get("travel_style", "")
        interests = ", ".join(profile.get("interests", []))
        pace = profile.get("pace", "moderate")
        description = profile.get("profile_description", "")

        # Category preferences from user selection
        cat_prefs = profile.get("category_preferences") or {}
        cat_rules = ""
        if cat_prefs:
            wanted = [k for k, v in cat_prefs.items() if v]
            unwanted = [k for k, v in cat_prefs.items() if not v]
            if unwanted:
                cat_rules += f"\nCATEGORY PREFERENCES (respect strictly):"
                cat_rules += f"\n- WANTED: {', '.join(wanted)}"
                cat_rules += f"\n- NOT WANTED: {', '.join(unwanted)} — MINIMIZE these categories. Include at most 1 per day and only if essential."
                if "restaurants" in unwanted:
                    cat_rules += "\n- The traveler does NOT want many restaurants. Include at most 1 restaurant/café per day for meals, do NOT fill slots with dining places."
            else:
                cat_rules += f"\n- Focus on: {', '.join(wanted)}"

        profile_section = f"""
TRAVELER PROFILE (personalize recommendations):
- Style: {style}
- Interests: {interests}
- Pace: {pace}
- Description: {description}
Prioritize places matching their interests while still creating a complete trip experience.
{cat_rules}
"""

    # ── Camada 2/3 — destination-type planning hints ─────────────────────
    # The destination classifier tagged this trip with a planning model.
    # Inject tailored instructions so Sonnet doesn't treat Thailand like
    # Paris. Without this block the prompt defaults to "walkable city with
    # pins," which fails tour-driven and multi-base destinations badly.
    dest_section = ""
    dest_classification = profile.get("destination_classification") or {}
    dest_type = dest_classification.get("destination_type")
    base_cities = dest_classification.get("base_cities") or []
    planning_notes = dest_classification.get("planning_notes") or []
    tour_dominant = bool(dest_classification.get("tour_dominant"))

    # Per-type instructions. These are the HEART of Camada 3 — destination
    # patterns the AI otherwise has to infer from scratch for every trip.
    type_playbooks = {
        "walkable_urban": (
            "PLANNING MODEL: WALKABLE URBAN\n"
            "- Group items by NEIGHBORHOOD; a day should flow as a walking route.\n"
            "- Adjacent attractions within 30 min walk cluster on the same day.\n"
            "- Prioritize iconic landmarks on early days (Eiffel before Montmartre).\n"
            "- Most items are direct map pins (museums, plazas, cafés, viewpoints)."
        ),
        "urban_excursion": (
            "PLANNING MODEL: URBAN + DAY TRIPS\n"
            "- Days 1-N cover the base city using walkable urban logic.\n"
            "- 1-2 days are DEDICATED DAY TRIPS to a secondary destination\n"
            "  (e.g., Tigre from Buenos Aires, Sintra from Lisbon). Label them\n"
            "  clearly and do NOT pad them with unrelated city items.\n"
            "- Return transfer back to base is implicit — don't schedule dinner\n"
            "   3 hours away from the hotel on a day trip night."
        ),
        "tour_driven": (
            "PLANNING MODEL: TOUR-DRIVEN DESTINATION\n"
            "- This destination is BUILT AROUND OPERATOR-LED EXCURSIONS. Do not\n"
            "  pretend every day is a walking tour.\n"
            "- Many activities fill a WHOLE day: island-hopping boat tours,\n"
            "  desert excursions, safari, lagoon circuits. Use duration_minutes\n"
            "  360-540 for these and only ADD a dinner spot — don't stack 4\n"
            "  attractions on a day that's already an 8-hour tour.\n"
            "- When the user's content mentions 'Maya Bay', 'Phi Phi', 'El Tatio',\n"
            "  'Jeri dunes', etc., model these as FULL-DAY guided trips, not\n"
            "  single map pins. Anchor the pin to the departure/main area and\n"
            "  include 'passeio de barco / tour' in the description.\n"
            "- Factor in typical pickup schedules (05:00-08:00 starts for tours)\n"
            "  when setting time_slot."
        ),
        "multi_base": (
            f"PLANNING MODEL: MULTI-BASE TRIP\n"
            f"- This trip uses MULTIPLE base cities: {', '.join(base_cities) if base_cities else 'see planning_notes'}.\n"
            "- Structure FIRST by base (days 1-3 Bangkok, 4-5 transfer to\n"
            "  Chiang Mai, 6-9 Chiang Mai, 10 transfer to Phuket, 11-15 Phuket).\n"
            "- Every base gets its own internal walkable/tour logic.\n"
            "- TRANSFER DAYS should contain a morning city activity + travel +\n"
            "  arrival check-in, NOT 5 attractions.\n"
            "- Respect the day_plan `city` field when it's set — it already\n"
            "  tells you which base each day belongs to.\n"
            "- NEVER mix items from two different bases on the same day."
        ),
    }

    if dest_type and dest_type in type_playbooks:
        dest_section = "\n" + type_playbooks[dest_type] + "\n"
        if tour_dominant and dest_type != "tour_driven":
            dest_section += (
                "- HEADS UP: this destination has significant tour-dominant\n"
                "  segments even though its primary model is {type}. Flag\n"
                "  operator-booked days clearly.\n"
            ).format(type=dest_type)
        if planning_notes:
            dest_section += "\nDESTINATION-SPECIFIC NOTES (from the classifier):\n"
            for note in planning_notes[:6]:
                dest_section += f"  - {note}\n"

    # STEP 4 — Inject external research (Tavily snippets) when available.
    # Gives Sonnet real-world itinerary structure instead of forcing it to
    # reason every destination from scratch. Only present for tour_driven
    # and multi_base destinations where Sonnet's internal knowledge alone
    # is weakest.
    external_research = profile.get("external_research")
    if external_research:
        dest_section += (
            "\nCOMMON PATTERNS FROM REAL TRAVEL GUIDES (use as structural reference,\n"
            "not as ground truth — cross-check against the user's video content):\n"
            f"{external_research}\n"
        )

    external_research_flex = profile.get("external_research_flexible")
    if external_research_flex:
        dest_section += (
            "\n"
            "╔═══════════════════════════════════════════════════════════════╗\n"
            "║  PESQUISA EXTERNA — LUGARES PARA OS DIAS SEM ROTEIRO FECHADO  ║\n"
            "║  (blogs e guias reais de viagem — use nos dias FLEXIBLE)      ║\n"
            "╚═══════════════════════════════════════════════════════════════╝\n"
            f"{external_research_flex}\n"
            "\n"
            "REGRAS PARA ESTA SEÇÃO (NÃO NEGOCIÁVEIS):\n"
            "1. Use estes lugares PRIORITARIAMENTE para preencher os dias marcados como\n"
            "   'flexible' na RIGIDITY TABLE — eles vêm de fontes reais externas, não do\n"
            "   seu treinamento.\n"
            "2. NUNCA duplique um lugar que já esteja em 'LUGARES DOS LINKS DO USUÁRIO'.\n"
            "   Se o mesmo lugar aparecer nos dois, ele pertence aos links — use a\n"
            "   pesquisa externa só para o que é NOVO.\n"
            "3. Se um snippet mencionar algo duvidoso (endereço vago, nome genérico tipo\n"
            "   'nice café near X'), prefira algo do seu conhecimento consolidado sobre\n"
            "   a cidade. Qualidade > quantidade.\n"
            "4. Dias locked do vídeo IGNORAM esta seção — eles já têm o conteúdo do\n"
            "   usuário e a seção 'ESTRUTURA DE DIAS DO VÍDEO'.\n"
        )

    # Source URLs for traceability
    sources_info = ""
    if source_urls:
        sources_info = f"\nContent extracted from: {', '.join(source_urls)}"

    # Structured places from user links (extracted in Phase 1)
    places_section = ""
    num_link_places = len(places_mentioned) if places_mentioned else 0
    # Slots must always accommodate every video-extracted place. The old
    # cap of min(num_days*5, 50) could force Sonnet to drop places (e.g.
    # a 7-day trip with 30 video places hit 35 slots with 80% ceiling = 28,
    # so 2 places were silently cut). Policy: fidelidade ao vídeo é
    # obrigatória — better a denser day (6-7 items) than a dropped place.
    base_daily = num_days * 5
    total_slots = max(base_daily, num_link_places)
    if places_mentioned:
        place_lines = []
        for p in places_mentioned:
            src = p.get("source_url", "link")
            place_lines.append(f"- {p['name']} (from: {src})")

        # Single unified instruction — ALL link places are always mandatory.
        # No "else" branch that tells Sonnet to choose the most iconic and
        # drop the rest. If places_mentioned outnumber the usual 5/day
        # pattern, Sonnet packs days denser rather than dropping.
        ai_companions_target = max(0, base_daily - num_link_places)
        packing_hint = (
            f"Adicione cerca de {ai_companions_target} lugares seus "
            f"(source: \"ai\") para completar {total_slots} vagas totais."
            if ai_companions_target > 0
            else (
                f"O vídeo tem {num_link_places} lugares — mais que a média "
                f"de {base_daily} vagas ({num_days} dias × 5). NÃO CORTE "
                "nenhum. Empacote dias mais densos (6-7 items/dia se "
                "precisar) em vez de descartar. Você ainda pode adicionar "
                "poucos complementos \"ai\" apenas para refeições essenciais "
                "se fizerem sentido geográfico."
            )
        )
        places_section = f"""
╔═══════════════════════════════════════════════════════════════╗
║  BASE DO ROTEIRO — LUGARES DOS LINKS DO USUÁRIO               ║
║  TODOS SÃO OBRIGATÓRIOS — NENHUM PODE SER DESCARTADO          ║
╚═══════════════════════════════════════════════════════════════╝
{chr(10).join(place_lines)}

REGRAS DURAS SOBRE ESTES LUGARES (NÃO NEGOCIÁVEIS):
1. TODOS os {num_link_places} lugares acima DEVEM aparecer no roteiro final.
   Zero exceções. Se um lugar parece duplicado de outro, mantenha os dois
   (o dedupe é feito por etapa separada, não por você).
2. TODOS devem ter "source": "link" — use exatamente o NOME da lista acima.
3. ELES SÃO OS PROTAGONISTAS — distribua-os ao longo dos {num_days} dias de forma geograficamente coerente.
4. O roteiro é CONSTRUÍDO AO REDOR deles. Os lugares adicionais da sua expertise (source: "ai") existem para:
   a) Incluir marcos obrigatórios da cidade que o vídeo não mencionou (landmarks imperdíveis).
   b) Agrupar por proximidade geográfica — se um lugar do link fica no bairro X, complete esse dia com outros lugares do bairro X.
   c) Preencher refeições, viewpoints no pôr-do-sol, cafés — completar os dias sem deslocamento longo.
5. {packing_hint}
6. Se algum lugar do link não fizer sentido geográfico com os outros, agrupe-o com outros do mesmo bairro (mesmo que você precise adicionar companheiros AI) — NUNCA descarte.
"""

    # Pre-planned day structure from links (e.g., "Day 1: X, Y, Z" from a travel video)
    preplanned_section = ""
    if day_plans_from_links:
        plan_lines = []
        for dp_link in day_plans_from_links:
            day_num = dp_link.get("day", 0)
            places_list = dp_link.get("places", [])
            src = dp_link.get("source_url", "link")
            if places_list and day_num:
                places_str = ", ".join(places_list)
                plan_lines.append(f"  Day {day_num}: {places_str} (from: {src})")
        if plan_lines:
            preplanned_section = f"""
╔═══════════════════════════════════════════════════════════════════╗
║  ⚡ REGRA #0 EM AÇÃO — ESTRUTURA DE DIAS DO VÍDEO DO USUÁRIO     ║
║  ESTA É A BASE ABSOLUTA DO ROTEIRO. NÃO REORDENE. NÃO REAGRUPE.  ║
╚═══════════════════════════════════════════════════════════════════╝
O conteúdo do link tem um plano dia-a-dia COMPLETO. O roteiro que você gera
DEVE seguir exatamente esta estrutura (Dia N do vídeo = Dia N do roteiro):

{chr(10).join(plan_lines)}

REGRAS OBRIGATÓRIAS (quebrar qualquer uma = falha do roteiro):
1. Os lugares acima ficam EXATAMENTE no dia especificado. NUNCA movê-los.
2. A ordem dentro de cada dia DEVE ser preservada.
3. Todos estes lugares têm "source": "link".
4. Você pode ADICIONAR lugares "source": "ai" para completar refeições,
   transições, ou pôr-do-sol — mas SEMPRE no mesmo dia e no mesmo bairro.
5. NUNCA remova nem substitua nenhum lugar pre-planejado.
6. Se o vídeo cobre só alguns dias e a viagem tem mais, use os dias vazios
   para complementar NA CIDADE PRINCIPAL (nunca começar com day trip — ver
   Regra #1).
7. Se o usuário abrir o vídeo e o roteiro lado a lado, o Dia 1 do roteiro
   DEVE conter os lugares do Dia 1 do vídeo, o Dia 2 os do Dia 2, e assim
   por diante. Testar mentalmente antes de responder.
"""

    # Quality rules that a real travel agent would never break.
    # These are product invariants, not suggestions — if the output violates
    # them the pipeline has extra post-processors that drop/dedupe items,
    # but it's cheaper and produces better text if Sonnet gets them right
    # the first time.
    planner_rules_section = """
╔═══════════════════════════════════════════════════════════════════╗
║  REGRAS DE PLANEJADOR HUMANO (se quebrar, o roteiro é inútil)     ║
╚═══════════════════════════════════════════════════════════════════╝

1. ZERO DUPLICAÇÃO ENTRE DIAS E DENTRO DO DIA.
   Um mesmo lugar NUNCA aparece duas vezes — nem no mesmo dia, nem em
   dias diferentes. Se "Casa Rosada" está no Dia 1, NÃO coloca de novo
   no Dia 3. Se um lugar do vídeo faz sentido em vários dias, escolha
   UM e ponto. Antes de fechar o JSON, reveja a lista e remova repetidos.

2. DAY-TRIPS SÃO DIAS INTEIROS — NÃO MISTURE COM A CIDADE BASE.
   Um day trip (Tigre, Versalhes, Sintra, Colonia del Sacramento, etc.)
   toma o dia inteiro (ida + atividade + volta = 6-10h). No dia de um
   day trip, você só pode incluir:
     a) O destino do day trip em si (ex: Tigre Delta).
     b) Atividades e refeições DENTRO da cidade do day trip (ex: almoço
        EM Tigre, Parque de la Costa EM Tigre).
   É PROIBIDO colocar no mesmo dia: Jardim Botânico de Buenos Aires,
   jantar em Palermo, bares em Recoleta, ou qualquer coisa na cidade
   base. O usuário está em Tigre o dia inteiro.

3. UM BAIRRO = UM DIA (concentração por neighborhood).
   Palermo inteiro vai num dia só. Recoleta inteira num dia. San Telmo
   inteiro num dia. Não fragmente: "Palermo de dia no Dia 4 + bares
   secretos de Palermo no Dia 3" é errado — tudo de Palermo vai junto.

4. NUNCA MENCIONE LUGARES DE OUTROS DIAS NAS NOTAS.
   A descrição / notes de um item do Dia 3 NUNCA pode dizer "depois
   aproveite os bares de Palermo" se Palermo está no Dia 4. O usuário
   lê as notes como instruções. Só escreva sobre lugares que estão
   efetivamente naquele dia.

5. CADA DIA PRECISA DE UM TEMA COERENTE.
   Um dia flexible NÃO É uma salada aleatória de atrações. Escolha uma
   lógica: bairro, vibe (tranquilo/intenso), ou half-day + half-day. Se
   não consegue justificar por que esses 5 lugares estão juntos no mesmo
   dia, refaça. Um planejador humano consegue responder "por que isso
   foi pro Dia 4?" com 1 frase clara.

"""

    # Multi-city awareness from day_plans
    city_section = ""
    cities_in_plans = {}
    for dp in day_plans:
        city = dp.get("city")
        if city:
            cities_in_plans.setdefault(city, []).append(dp["day_number"])
    if cities_in_plans:
        city_lines = []
        for city, days in cities_in_plans.items():
            day_str = ", ".join(str(d) for d in days)
            city_lines.append(f"- {city}: Days {day_str}")
        city_section = f"""
CITY ASSIGNMENTS (places MUST match the city assigned to each day):
{chr(10).join(city_lines)}
IMPORTANT: When generating places, search for attractions IN THE CORRECT CITY for each day. Don't put Las Vegas attractions on a Zion day or vice versa. Each city has its own iconic attractions — use them.
"""
        # Override destination for multi-city
        destination = " / ".join(cities_in_plans.keys())

    # Phase 3 — authoritative rigidity table. When content_classification
    # produced canonical_days, this block tells Claude exactly which days
    # are locked (from a D-category video) vs flexible (AI-created).
    # Pull day-level activity hints + alternatives from the consolidated
    # content_classification so they can be injected next to the rigidity
    # table. These were previously lost — "rooftop ou shopping", "cachoeira
    # próxima", "festa à noite" all got discarded because they weren't
    # proper-noun places.
    cc_blob = (profile.get("content_classification") or {})
    day_alternatives = cc_blob.get("day_alternatives") or {}
    # day_alternatives is keyed by day number (possibly as string after JSON
    # roundtrip through Rails). Normalize to int.
    normalized_alternatives: dict[int, list[list[str]]] = {}
    for k, v in day_alternatives.items():
        try:
            normalized_alternatives[int(k)] = v
        except (TypeError, ValueError):
            continue

    rigidity_section = ""
    if canonical_days or day_rigidity:
        rigidity_lines: list[str] = []
        for n in range(1, num_days + 1):
            rig = day_rigidity.get(n, "flexible")
            entry = canonical_days.get(n) or {}
            places = entry.get("places") or []
            hints = entry.get("activity_hints") or []
            alts_for_day = normalized_alternatives.get(n) or []
            places_str = ", ".join(places) if places else "(none named)"
            hints_str = "; ".join(hints)
            alts_str = " | ".join(
                "(" + " OR ".join(opts) + ")" for opts in alts_for_day if opts
            )

            if rig == "locked" and entry:
                creator = entry.get("creator") or "video"
                day_type_hint = "DAY TRIP" if entry.get("is_day_trip") else "urban"
                line = (
                    f"  Dia {n} → LOCKED ({day_type_hint}, from {creator}). "
                    f"Locked places (must appear in this exact order): {places_str}"
                )
                if hints:
                    line += f" | MUST also include concrete venues for these hints: {hints_str}"
                if alts_str:
                    line += f" | Creator offered alternatives: {alts_str}"
                rigidity_lines.append(line)
            elif rig == "partially_flexible" and entry:
                line = (
                    f"  Dia {n} → PARTIALLY_FLEXIBLE. Seed places (keep on this day): {places_str}"
                )
                if hints:
                    line += f" | MUST also cover these video hints: {hints_str}"
                if alts_str:
                    line += f" | Alternatives to surface: {alts_str}"
                rigidity_lines.append(line)
            elif hints or alts_str:
                # Flexible day but the video still suggested things for it.
                line = f"  Dia {n} → FLEXIBLE, but video suggested:"
                if hints:
                    line += f" hints={hints_str};"
                if alts_str:
                    line += f" alternatives={alts_str};"
                line += " treat these as HIGH-PRIORITY seeds when building the day."
                rigidity_lines.append(line)
            else:
                rigidity_lines.append(f"  Dia {n} → FLEXIBLE (build from your expertise)")
        rigidity_section = f"""
╔═══════════════════════════════════════════════════════════════════╗
║  REGRA #0.5 — TABELA DE RIGIDEZ POR DIA (AUTHORITATIVE)          ║
║  This is the source of truth. Day-level decisions MUST match it. ║
╚═══════════════════════════════════════════════════════════════════╝
{chr(10).join(rigidity_lines)}

HOW TO READ THIS TABLE:
- LOCKED: the video structured this exact day. Copy it 1:1. Do NOT add,
  remove, reorder, or move items. You MAY insert meal / viewpoint slots
  IN THE SAME DAY IN THE SAME NEIGHBORHOOD to complete it (breakfast,
  lunch, sunset), but the core sequence stays untouched.
- PARTIALLY_FLEXIBLE: seed places stay on this day, but you can add
  complementary items around them (meals, nearby attractions).
- FLEXIBLE: build this day freely using the destination's landmarks and
  your expertise. Match the pace/vibe of any LOCKED days.

ACTIVITY HINTS (CRITICAL — THIS IS NEW):
When a day says "MUST also include concrete venues for these hints: X, Y",
it means the CREATOR of the video verbally suggested X and Y for that day,
even though they didn't name a specific place. You MUST pick a real venue
that fits each hint IN THAT DAY'S CITY and mark it with "source": "link"
(because the creator suggested it, even if not by proper noun). Examples:
  hint "rooftop bar with city view" on Day 3 in Bangkok → "Mahanakhon
    SkyWalk" or "Sky Bar at lebua" (pick one, set source=link)
  hint "nearby waterfall" on Day 4 in Chiang Mai → "Huay Kaew Waterfall"
    or "Mae Sa Waterfall" (pick one, set source=link)
  hint "street food market" on Day 3 in Bangkok → "Chinatown Yaowarat"
    (pick the iconic one, source=link)
Failing to cover an explicit hint = failing the user's video.

ALTERNATIVES (when creator offered options like "rooftop OU shopping"):
For each "(A OR B)" block, emit TWO items for that day — one for each
option — with the same `alternative_group` value (e.g., "day3_evening"),
so the UI renders them as mutually exclusive choices. Both get
source: "link" because the creator mentioned both. Do NOT pick one
silently — the user wants to see the choice.

A traveler who opens the video side-by-side with the itinerary MUST see
Day N map to Day N of the video, WITH every place AND every hint the
creator mentioned covered.
"""

    return f"""You are an expert travel planner building a {num_days}-day itinerary for {destination}.
Think like someone who has visited {destination} 50 times and knows exactly what makes a trip unforgettable.
{rigidity_section}

╔═══════════════════════════════════════════════════════════════════╗
║  REGRA #0 — PRIORIDADE ABSOLUTA: SEGUIR A ESTRUTURA DO VÍDEO     ║
║  (READ THIS BEFORE EVERYTHING ELSE — THIS OVERRIDES ALL OTHER    ║
║  RULES WHEN IN CONFLICT)                                          ║
╚═══════════════════════════════════════════════════════════════════╝
Se o vídeo/link do usuário JÁ estrutura os dias (ex: "Dia 1: Avenida 9 de Julho,
Rua Florida, Galería Güemes, Casa Rosada / Dia 2: Recoleta, Palermo / Dia 3:
Tigre..."), o roteiro que você gera DEVE COPIAR essa estrutura exatamente.
- Dia N do vídeo → Dia N do roteiro (mesma ordem, mesmos lugares, mesmo agrupamento).
- Se o vídeo diz que o Dia 1 é Centro Histórico de Buenos Aires, o Dia 1 do
  seu roteiro é Centro Histórico de Buenos Aires. NÃO INVENTE outro começo.
- NUNCA reordene os dias do vídeo. NUNCA mova um lugar do Dia 2 do vídeo
  para o Dia 1 do roteiro. O usuário quer SEGUIR o vídeo, não receber uma
  versão "melhorada" dele.
- Você só pode COMPLETAR cada dia (adicionar almoço, jantar, viewpoint ao
  pôr-do-sol) com lugares do mesmo bairro — mas o NÚCLEO do dia é o que o
  vídeo mandou.

Verificação mental: se o usuário abrir o roteiro lado a lado com o vídeo, a
ordem dos dias deve bater 1:1. Se não bate, você falhou.

╔═══════════════════════════════════════════════════════════════════╗
║  REGRA #1 — ORGANIZAÇÃO POR CIDADE (NÃO NEGOCIÁVEL)              ║
╚═══════════════════════════════════════════════════════════════════╝
Toda viagem tem UMA cidade principal (a cidade do destino: Buenos Aires,
Paris, Tóquio, Rio de Janeiro etc.). Day trips existem para OUTRAS cidades
menores próximas (Tigre, Colônia do Sacramento, Mendoza, Versalhes, Nikko,
Petrópolis etc.).

Regras duras:
1. **Dia 1 SEMPRE é na cidade principal.** Um turista que chega em Buenos Aires
   NÃO começa a viagem em Tigre. Começa em Buenos Aires (Puerto Madero,
   Recoleta, Microcentro, Palermo — a CIDADE que define o destino).
2. **Dia 2 também é na cidade principal.** Dois primeiros dias são dedicados
   a conhecer a cidade-destino antes de qualquer escapada.
3. **Day trips para outras cidades SÓ a partir do Dia 3** (se a viagem for
   de 3+ dias). Em uma viagem de 2 dias, NUNCA tenha day trip para fora.
4. **Exceção única:** se a REGRA #0 (estrutura do vídeo) explicitamente
   colocar um day trip antes do Dia 3, siga o vídeo — mas essa é a única
   situação em que essa ordem muda.

Exemplo concreto (Buenos Aires, 5 dias):
  ✅ CORRETO: Dia 1 = Microcentro/Plaza de Mayo; Dia 2 = Recoleta/Palermo;
     Dia 3 = Tigre (day trip); Dia 4 = San Telmo/La Boca; Dia 5 = Puerto Madero.
  ❌ ERRADO: Dia 1 = Tigre (o turista nem conhece Buenos Aires ainda!).

MINDSET — Think like a real traveler:
1. POSTCARDS FIRST: When a traveler arrives at a destination, they want to SEE the place — the landmarks, \
the views, the spots that define the city. The first days should feel like "I'm really HERE!" with the destination's \
most recognizable attractions and iconic views. This doesn't mean a strict ranking of popularity — it means the \
early days set the tone with the experiences that make the traveler feel connected to where they are. \
Local hidden gems, deep neighborhood exploration, and niche discoveries flow naturally into the middle and later days \
once the traveler has oriented themselves and seen the city's identity.
2. EVERY DAY MUST BE A FULL DAY (10:00 → 19:00): A traveler's day is LONG — they didn't fly across the world to do 2 things and go back to the hotel. \
Each day needs 4-5 activities that FILL the day from morning to evening: \
10:00 morning activity → 12:30 lunch → 14:30 afternoon activity → 16:30 late afternoon activity → 19:00 dinner. \
Two 1-hour attractions alone do NOT make a day. If an attraction takes 1 hour, what does the traveler do for the other 8 hours? \
ALWAYS fill the gaps with nearby walks, cafés, viewpoints, markets, or neighborhoods to explore.
3. EMOTIONAL ARC — ARRIVE → EXPLORE → DISCOVER: \
Early days = the city's identity (iconic landmarks, recognizable views, the spots that define the destination). \
Middle days = deeper exploration (neighborhoods, local food, markets, cultural gems, lesser-known areas). \
Last day = something special and memorable (best viewpoint, farewell dinner, unique experience). \
The trip should feel like a natural progression from "wow, I'm here!" to "I really know this place".
4. REAL-WORLD LOGIC: A traveler's day starts at 10:00 (after hotel breakfast + getting ready), NOT 6am or 9am. Morning = main attractions (less crowded). Lunch = local restaurant nearby (12:30-14:00). Afternoon = explore/shopping. Evening = dinner + viewpoint/nightlife. Last activity ends by 20:00-21:00.
5. GEOGRAPHIC CLUSTERS (CRITICAL — THIS IS THE MOST IMPORTANT RULE):
   - ALL places on the same day MUST be within a reasonable area — walkable or a short drive (max 20-30 min between consecutive stops).
   - NEVER put places on opposite sides of the city on the same day. A traveler CANNOT visit Hollywood in the morning and then Venice Beach at noon and then Pasadena in the afternoon — that's hours of driving.
   - Think in NEIGHBORHOODS: pick a zone of the city for each day and stay there. Morning, lunch, afternoon, dinner — all in the same area.
   - If two places are in the same neighborhood, they MUST be on the same day.
   - If two places are far apart, they MUST be on DIFFERENT days.
   - A real traveler has limited time — wasting 2 hours in traffic between stops ruins the day.
6. FULL-DAY vs SHORT ACTIVITIES: Use your judgment. Theme parks, day trips, long hikes, safaris — these genuinely fill a whole day (set duration_minutes to 360-600). A boat tour, a market visit, a single museum — these take 1-3 hours and need to be paired with other activities to make a complete day.
7. STRATEGIC TIMING (THINK BEFORE PLACING — THIS IS CRITICAL):
   Before assigning a time slot, ASK YOURSELF: "When is the BEST moment to experience this place?"
   - Viewpoints, observation decks, bridges with views, waterfronts, rooftop bars → ALWAYS at SUNSET. \
     The Trocadéro at 10am is just a terrace. The Trocadéro at sunset with the Eiffel Tower glowing is MAGIC. \
     Estimate sunset time for the destination + month and schedule 1-2 hours before.
   - Museums, galleries → morning (10:00-12:00), fewer crowds, fresh energy
   - Markets, bakeries → mid-morning (10:00-11:00), freshest products, most lively
   - Parks, gardens, outdoor walks → afternoon (14:00-16:00), nice weather
   - Nightlife districts, bars → evening (20:00+)
   - Cafés → mid-morning break (11:00) or mid-afternoon break (15:30)
   - Churches, temples → early morning (fewer tourists) or late afternoon (golden light)
   - Beach/waterfront → any time, but sunset is always best for photos
   DO NOT just assign random times. Each place has a PERFECT moment — find it.
8. SMART PAIRING — Think like a local guide. What do experienced travelers do TOGETHER?
   Research what real travelers and travel blogs recommend as combinations:
   - Trocadéro → Eiffel Tower → Seine River Cruise (all in the same area, natural progression)
   - Colosseum → Roman Forum → Palatine Hill (same ticket, same zone, same morning)
   - Central Park → Metropolitan Museum → Upper East Side lunch (all walkable)
   - Shibuya Crossing → Hachiko Statue → Shibuya Sky → dinner in Shibuya (same neighborhood)
   - Viewpoint at sunset → dinner nearby with a view (the PERFECT evening combo)
   - Morning market visit → street food lunch at/near the market → afternoon neighborhood walk
   - Beach morning → seafood lunch by the water → coastal walk → sunset drinks
   THINK: "If I'm already at Place A, what is the OBVIOUS next thing to do nearby?" That's what goes next in the itinerary.

DESTINATION LANDMARKS ARE MANDATORY (THIS IS NON-NEGOTIABLE — READ THIS CAREFULLY):
Every destination has places that are SO iconic that skipping them would make the itinerary feel incomplete and amateur. \
These MUST be included even if the user's video/links don't mention them. A traveler who goes to a city and misses its \
most famous landmarks will blame the itinerary — and they'd be right.

Think: "If someone told me they went to [destination] and DIDN'T visit [landmark], I would say they missed the whole point."

Examples (apply this logic to ANY destination):
- Paris → Eiffel Tower, Louvre, Arc de Triomphe, Notre-Dame, Champs-Elysees, Montmartre/Sacre-Coeur
- Los Angeles → Hollywood Walk of Fame, Hollywood Sign viewpoint, Santa Monica Pier, Griffith Observatory, Universal Studios or Warner Bros
- Rome → Colosseum, Vatican/St Peter's, Trevi Fountain, Pantheon, Spanish Steps, Roman Forum
- Tokyo → Senso-ji, Shibuya Crossing, Meiji Shrine, Shinjuku, Akihabara, Tokyo Tower/Skytree
- New York → Statue of Liberty, Central Park, Times Square, Brooklyn Bridge, Empire State Building
- London → Big Ben, Tower Bridge, Buckingham Palace, British Museum, London Eye
- Barcelona → Sagrada Familia, Park Guell, La Rambla, Casa Batllo, Gothic Quarter
- Rio → Cristo Redentor, Pao de Acucar, Copacabana, Ipanema, Escadaria Selaron
- Dubai → Burj Khalifa, Dubai Mall, Palm Jumeirah, Dubai Marina, Gold Souk
- Istanbul → Hagia Sophia, Blue Mosque, Grand Bazaar, Topkapi Palace, Basilica Cistern, Galata Tower
- Bangkok → Grand Palace, Wat Pho, Wat Arun, Chatuchak Market, Khao San Road
- Lisbon → Torre de Belém, Mosteiro dos Jerónimos, Praça do Comércio, Alfama, Tram 28, Castelo de São Jorge

For ANY destination not listed above, use your knowledge as an expert traveler to identify the 5-8 places that DEFINE the city. \
These are the places that appear on every postcard, every travel guide, every "top things to do" list. INCLUDE THEM.

IMPORTANT: The link content is INSPIRATION, not the limit. If the video only talks about food, you STILL include the landmarks. \
If the video only shows one neighborhood, you STILL include the must-see attractions from other parts of the city. \
The traveler expects a COMPLETE trip, not a copy of one video.
{existing_info}
{profile_section}
{dest_section}
{city_section}
{sources_info}
{places_section}
{preplanned_section}
{planner_rules_section}
╔═══════════════════════════════════════════════════════════════╗
║  WORKFLOW FOR THIS ITINERARY (FOLLOW IN ORDER)               ║
╚═══════════════════════════════════════════════════════════════╝
STEP 0 — RESPECT THE VIDEO'S DAY STRUCTURE (Regra #0)
   If the content describes days ("Dia 1: X, Y, Z | Dia 2: ..."), copy that
   structure as-is. Day N of the video → Day N of the itinerary. Never
   reorder. Never move a Day 2 place to Day 1 to "improve" the flow.

STEP 1 — ENFORCE MAIN CITY PRIORITY (Regra #1)
   Check which places belong to the MAIN city ({destination}'s core) vs
   day-trip cities (Tigre, Colônia, Versailles, Nikko, etc.).
   - Day 1 + Day 2 must be main-city only. No day trips in the first 48h.
   - Day trips are allowed from Day 3 onward.
   - If the video explicitly puts a day trip earlier, Regra #0 wins — but
     in the absence of an explicit video structure, NEVER start Day 1 in
     a secondary city.

STEP 2 — ANCHOR THE LINK PLACES
   Look at the PLACES FROM USER'S LINKS section. Mentally locate each on a map of {destination}.
   Group them by NEIGHBORHOOD / PROXIMITY. Places in the same area = same day.

STEP 3 — ADD MANDATORY LANDMARKS
   Check the DESTINATION LANDMARKS list above. Any iconic landmark from {destination} that is
   NOT covered by the link places MUST be added. Place it on the day whose neighborhood matches.
   Never skip a top-5 landmark of the city because the video didn't mention it.

STEP 4 — FILL EACH DAY BY PROXIMITY (NOT BY THEME)
   For each day, pick ONE neighborhood/zone. Group all morning/lunch/afternoon/evening activities
   within that zone. Maximum walking/driving between consecutive stops: 20 minutes.
   Do NOT build a "beach day" with beaches from 3 different parts of town. Do NOT build a "food day"
   with restaurants scattered across the city.

STEP 5 — COMPLETE THE DAY (10:00 → 20:00)
   Each day needs 4-5 places filling morning → lunch → afternoon → late afternoon → dinner/viewpoint.
   Sunset viewpoints ALWAYS near the end of the day.

RULES RECAP (in order of priority):
- **REGRA #0 (overrides everything):** video's day structure is law. Copy it 1:1.
- **REGRA #1:** Day 1 + 2 = main city. Day trips to other cities only from Day 3+.
- Every link place MUST appear in the final itinerary (unless there are >80% of slots worth of them).
- Every link place MUST have "source": "link".
- Every AI-added place MUST have "source": "ai".
- Same-day places MUST be in the same neighborhood/zone.
- Top landmarks of {destination} MUST be present even if the video didn't mention them.

Return ONLY a JSON array with {total_slots} places across ALL {num_days} days (about 5 per day). Each object:
{{"day": <1-{num_days}>, "name": "Exact Place Name", "category": "restaurant|attraction|activity|shopping|cafe|nightlife|other", "time_slot": "10:00", "duration_minutes": 90, "description": "What makes this special + practical tip in Portuguese.", "notes": "Insider tip in Portuguese.", "vibe_tags": ["tag1", "tag2"], "alerts": ["alert text in Portuguese"], "alternative_group": null, "source": "link|ai", "activity_model": "direct_place|anchored_experience|guided_excursion|route_cluster|day_trip|transfer", "visit_mode": "self_guided|guided|book_separately|operator_based"}}

ACTIVITY_MODEL rules (MANDATORY — Camada 4 of the planning spec):
- "direct_place" — a walkable pin (museum, café, plaza, viewpoint, restaurant). Most urban items.
- "anchored_experience" — the experience has a clear map anchor but is more than just a visit (e.g. Maya Bay, Floating Market). duration 120-240 min typically.
- "guided_excursion" — a full-day OPERATOR-LED trip (island hopping, desert tour, safari). duration 360-540. Usually one per day.
- "route_cluster" — a REGIONAL CIRCUIT of places traveled together (e.g. east-side Atacama tour). Anchor to the starting area.
- "day_trip" — a day dedicated to a SECONDARY city (Tigre from BA, Sintra from Lisbon). Signals to the UI that it's a bate-volta.
- "transfer" — a travel day between base cities (e.g. Bangkok→Chiang Mai). Duration reflects the trip time. 1-2 short activities max.

═══════════════════════════════════════════════════════════════
  DESTINATION ≠ ACTIVITY (HARD RULE, STEP 7 of the planning spec)
═══════════════════════════════════════════════════════════════
- NEVER emit an item whose NAME is just a destination (a city, country,
  region, or neighborhood). Destinations are CONTAINERS, not activities.
  ✗ WRONG: {{"day": 2, "name": "Paris", ...}}
  ✗ WRONG: {{"day": 3, "name": "Phuket", ...}}
  ✗ WRONG: {{"day": 5, "name": "Tailândia", ...}}
  ✓ RIGHT: {{"day": 2, "name": "Louvre Museum", ...}}
  ✓ RIGHT: {{"day": 3, "name": "Phi Phi Islands day tour", "activity_model": "guided_excursion", ...}}
- Every item must have at least one CONCRETE action (visit X, eat at Y,
  take a boat to Z, walk through <neighborhood>). "Explore Paris" is too
  vague unless accompanied by specific streets/landmarks.
- A day that contains only a destination name is a broken day. Fill it
  with real places — this is the entire point of the service.

═══════════════════════════════════════════════════════════════
  NO GENERIC CATEGORY ITEMS — ALWAYS A NAMED VENUE (HARD RULE)
═══════════════════════════════════════════════════════════════
This is where the #1 user complaint comes from. When the video mentions
a type of place ("rooftop", "street food", "floating market") you MUST
output a SPECIFIC named venue, never the category as the item name.

✗ FORBIDDEN ITEM NAMES (these destroy the itinerary):
  "rooftop bars"             → pick a SPECIFIC rooftop (Mahanakhon SkyWalk)
  "city exploration"         → break into actual attractions
  "explorar a cidade"        → same
  "relaxar na praia"         → pick a SPECIFIC beach (Railay Beach West)
  "beach day"                → same
  "cultural immersion"       → pick a SPECIFIC museum or cultural site
  "food tour"                → pick a SPECIFIC market/street/restaurant
  "mercados locais"          → pick SPECIFIC markets by name
  "templos budistas"         → pick SPECIFIC temples by name
  "vida noturna"             → pick a SPECIFIC club/bar
  "descansar"                → break into 2-3 specific activities
  "passeio de ilhas"         → name the SPECIFIC tour (Similan Islands
                                day tour, Phi Phi Islands boat tour, etc.)

✓ CORRECT BEHAVIOR when the video says "rooftop ou shopping":
  Emit TWO separate items, both with source="link":
    • {{"name": "Mahanakhon SkyWalk", "category": "attraction", "alternative_group": "day3_evening"}}
    • {{"name": "Iconsiam", "category": "shopping", "alternative_group": "day3_evening"}}
  The alternative_group signals to the UI: these are mutually exclusive.

✓ CORRECT BEHAVIOR when the video says "relaxar na praia" for 3 days:
  That's THREE SEPARATE beaches / activities, not "relax" × 3:
    Day 12: {{"name": "Patong Beach", "description": "Praia icônica com vida noturna"}}
            {{"name": "Patong night market", "description": "Compras e comida à noite"}}
    Day 13: {{"name": "Similan Islands day tour", "activity_model": "guided_excursion"}}
    Day 14: {{"name": "Big Buddha Phuket"}}
            {{"name": "Kata Beach", "description": "Praia tranquila no sul"}}

Rule of thumb: if your proposed item name would fit 50 different
destinations ("rooftop bars" fits any city with rooftops), it's too
generic. Make it a REAL venue name.

═══════════════════════════════════════════════════════════════
  DAY COMPLETENESS (HARD RULE, STEP 6)
═══════════════════════════════════════════════════════════════
- Every day must contain EITHER:
    (a) at least 2 coherent activities that flow geographically, OR
    (b) exactly one full-day activity (duration_minutes ≥ 360) — typically
        a guided_excursion, day_trip, or transfer.
- A day with 1 short item (duration < 360) is INVALID. Either add more
  items around it or upgrade it to a full-day experience.

═══════════════════════════════════════════════════════════════
  TRANSPORT BETWEEN BASES (HARD RULE, STEP 8)
═══════════════════════════════════════════════════════════════
- Multi-base trips: when two consecutive days have DIFFERENT `city`
  values on their day_plan, the second day MUST include a "transfer"
  activity_model item (travel logistics: flight/train/van). Do not
  pretend the traveler magically appears in the next city.
- The transfer item covers the morning or midday of the travel day and
  leaves room for 1 light activity after arrival.

VISIT_MODE rules:
- "self_guided" — traveler just shows up (walks, parks, most attractions, restaurants).
- "guided" — typically done with a tour guide but not an operator package (free walking tour, museum audioguide).
- "book_separately" — requires advance booking (popular restaurants, shows, some experiences).
- "operator_based" — must book through a tour operator (all guided_excursion items).

These two new fields are REQUIRED for every item. Get them right especially for tour_driven and multi_base destinations — it's what makes the cards honest about what the traveler is actually doing.

PORTUGUESE LANGUAGE RULES (MANDATORY — apply to ALL text fields: description, notes, alerts):
- Write in PERFECT Brazilian Portuguese (pt-BR) with FLAWLESS grammar.
- ALWAYS use proper accents: á, é, í, ó, ú, â, ê, ô, ã, õ, à.
- ALWAYS use cedilla: ç (e.g., "praça", "recomendação", "começa").
- ALWAYS use proper punctuation: commas, periods, exclamation marks.
- Examples of CORRECT writing:
  ✓ "Chegue cedo para evitar filas — a vista do pôr do sol é imperdível."
  ✓ "Recomendação: peça o açaí na barraca à esquerda da entrada."
  ✓ "Praça icônica com arquitetura renascentista e músicos de rua à noite."
  ✗ NEVER write: "Praca iconica com arquitetura renascentista" (missing ç, ô)
  ✗ NEVER write: "Recomendacao: peca o acai" (missing ã, ç, í)
- Treat every text field as if it will be published in a professional travel guide.

SOURCE FIELD RULES:
1) Every place from PLACES FROM USER'S LINKS MUST have "source": "link". Use the EXACT name from that list.
2) Every place YOU add from your own knowledge MUST have "source": "ai".
3) If a place name matches or is clearly the same as one in the PLACES FROM USER'S LINKS list, it is "link" — not "ai".

EXAMPLE OF WHAT NOT TO DO:
❌ A day with only ONE short activity (e.g., a 90-min boat tour alone for the whole day). The traveler has nothing else to do!
✅ Combine that boat tour with a nearby neighborhood walk, a local restaurant, and an evening viewpoint — now it's a FULL day.

FULL-DAY vs SHORT ACTIVITIES — use your judgment:
Some activities genuinely fill a whole day (1-2 items is OK, add a dinner spot):
- Theme parks → duration_minutes: 480-600
- Day trips to another city → duration_minutes: 480-600
- Long hikes or nature excursions → duration_minutes: 360-480
- Safaris, beach/resort days → duration_minutes: 360-480
Short activities (under 3 hours — boat tours, markets, single museums) are NEVER a full day. Always pair with 2-3 other places.

HARD RULES:
- You MUST use ALL days from 1 to {num_days}.
- Normal days: 4-5 places per day. NEVER less than 3 unless the day has a full-day activity (duration_minutes >= 360).
- Day 1 MUST start with an iconic attraction that makes the traveler feel "I'm really here!" The first days should feature the destination's landmarks and recognizable spots. Hidden gems and deep local exploration fit naturally into the middle/later days.
- Include at least 1 restaurant/cafe per day for meals — travelers need to eat!

- Order within each day: morning activity → lunch spot → afternoon activity → evening (dinner/nightlife/viewpoint).
- The LAST day must also feel complete. Don't be lazy with the final day — make it memorable.
- PROXIMITY IS NON-NEGOTIABLE: Every place in a day must be reachable from the previous one by car in under 30 minutes or by walking in under 20 minutes. If you cannot guarantee this, move the place to a different day where it fits geographically. The traveler must be able to realistically complete ALL items in a single day without spending their entire day in traffic.
- vibe_tags: pick 1-3 from: instagramavel, hidden_gem, romantico, comida_de_rua, vida_noturna, familiar, cultural, ao_ar_livre, luxo, economico, historico, cafe_trabalho, vista_panoramica
- alerts: practical warnings in Portuguese like "Fechado nas segundas-feiras", "Reserva recomendada", "Chega cedo para evitar filas". Only add if relevant.
- alternative_group: when 2 similar options exist for the same time slot (e.g., two brunch places), give them the SAME group ID like "day1_morning_cafe". Most items should be null.

BEFORE RETURNING YOUR JSON — SELF-CHECK (MANDATORY, IN THIS ORDER):
1. **Regra #0 compliance:** Does Day N of the itinerary match Day N of the video?
   If the video said "Dia 1: A, B, C", is your Day 1 built around A, B, C? If NOT — fix it NOW.
2. **Regra #1 compliance:** Are Days 1 and 2 in the main city ({destination}'s core)?
   If Day 1 starts in a secondary/day-trip city (Tigre, Versailles, Nikko, Colônia, etc.) AND
   the video didn't explicitly put it there → MOVE it. Day 1 must feel like "I'm really in the main city."
3. Count: how many of {destination}'s top 5-8 iconic landmarks did you include? If fewer than 5 iconic landmarks → ADD MORE. This is a top quality metric.
4. A first-time visitor MUST see ALL the highlights. The user WILL judge the itinerary by whether the famous places are there.
5. Does each day have 4-5 items filling 10:00 → 19:00? If any day has fewer than 4 items, add more nearby places NOW.
6. Is there at least 1 restaurant/café per day? If not, add one.
7. Are viewpoints/rooftops scheduled at sunset? Fix if not.

Raw content from user's links (reference material — places are already listed above in PLACES FROM USER'S LINKS):
{content_text[:8000]}"""


def _optimize_day_proximity(
    place_list: list[dict],
    day_rigidity: dict[int, str] | None = None,
) -> list[dict]:
    """Reorder items within each day by geographic proximity (nearest-neighbor),
    and swap outliers between days if a place fits better geographically in another day.

    Key behaviors:
      - Within a day, we ALWAYS reorder for best walking/driving path —
        including locked days. Reordering items inside the same day does NOT
        violate Regra #0 (the items stay on the day the video assigned);
        only the sequence changes. Time slots are reassigned by position
        so the morning anchor stays at 10:00 etc.
      - Between days we never move a link-sourced / video-anchored item OUT
        of a locked day, and never INTO a locked day. For flexible-vs-
        flexible, we swap when the item is meaningfully closer to the
        other day's centroid (ratio 0.6×) or absolute distance > 15km.
    """
    if not place_list:
        return place_list

    day_rigidity = day_rigidity or {}

    # Group by day
    by_day: dict[int, list[dict]] = {}
    for p in place_list:
        d = p.get("day", 1)
        by_day.setdefault(d, []).append(p)

    # Step 1: Swap outliers between days.
    # New heuristic: swap if (a) >15km absolute from own centroid, OR
    # (b) another day's centroid is at least 40% closer than own.
    # Case (b) catches the "purple day's pin 1 is right next to red day's
    # cluster but my own centroid is also nearby" scenario the user saw.
    MAX_SWAP_DISTANCE = 15
    SIGNIFICANT_RATIO = 0.6

    def _centroid(items):
        lats = [float(i["latitude"]) for i in items if i.get("latitude")]
        lngs = [float(i["longitude"]) for i in items if i.get("longitude")]
        if not lats:
            return None
        return (sum(lats) / len(lats), sum(lngs) / len(lngs))

    centroids = {}
    for d, items in by_day.items():
        c = _centroid(items)
        if c:
            centroids[d] = c

    swaps_made = 0
    for d in list(by_day.keys()):
        if d not in centroids:
            continue
        if day_rigidity.get(d) == "locked":
            continue
        items = by_day[d]
        i = 0
        while i < len(items):
            item = items[i]
            lat = item.get("latitude")
            lng = item.get("longitude")
            if not lat or not lng:
                i += 1
                continue
            # NEVER move link-sourced items even between flexible days —
            # their day came from the video.
            if item.get("source") == "link" or item.get("origin") == "extracted_from_video":
                i += 1
                continue

            dist_to_own = _haversine_km(centroids[d][0], centroids[d][1], float(lat), float(lng))

            # Find best alternative day (not locked, has room).
            best_day = d
            best_dist = dist_to_own
            for other_d, other_c in centroids.items():
                if other_d == d:
                    continue
                if day_rigidity.get(other_d) == "locked":
                    continue
                if len(by_day.get(other_d, [])) >= 6:
                    continue
                dist_other = _haversine_km(
                    other_c[0], other_c[1], float(lat), float(lng),
                )
                if dist_other < best_dist:
                    best_dist = dist_other
                    best_day = other_d

            # Swap if: absolute outlier (>15km) OR significantly closer
            # elsewhere (>40% reduction in distance).
            should_swap = best_day != d and (
                dist_to_own > MAX_SWAP_DISTANCE
                or best_dist < dist_to_own * SIGNIFICANT_RATIO
            )
            if should_swap:
                moved = items.pop(i)
                moved["day"] = best_day
                by_day.setdefault(best_day, []).append(moved)
                swaps_made += 1
                logger.info(
                    "[proximity] Moved '%s' from day %d to day %d (%.1fkm → %.1fkm)",
                    moved.get("name"), d, best_day, dist_to_own, best_dist,
                )
                continue  # list shifted, don't increment i
            i += 1

    if swaps_made:
        logger.info(
            "[proximity] Swapped %d items between days for better routing",
            swaps_made,
        )

    # Step 2: Reorder items within each day by nearest-neighbor walking
    # path — INCLUDING locked days (reordering sequence doesn't violate
    # Regra #0; it just makes the walking path efficient). Time slots are
    # reassigned by position afterwards so morning stays morning even if
    # a different item now sits in position 0.
    #
    # NIGHTLIFE FIX: items categorized as nightlife/bar/club get pushed
    # to the end of the day and pinned to evening slots (20:00+). An
    # earlier version applied positional slots blindly and landed
    # "Phi Phi Island Nightlife" at 14:30 — obviously wrong.
    default_time_slots = ["10:00", "12:30", "14:30", "16:30", "19:00"]
    evening_slots = ["20:00", "21:30"]
    NIGHTLIFE_CATEGORIES = {"nightlife", "bar", "club", "vida_noturna"}

    def _is_nightlife(item: dict) -> bool:
        cat = str(item.get("category") or "").lower()
        if cat in NIGHTLIFE_CATEGORIES:
            return True
        # Heuristic fallback: name contains a nightlife keyword. Catches
        # cases where the LLM mislabels ("attraction" for a rooftop bar).
        name = str(item.get("name") or "").lower()
        for kw in ("nightlife", "cocktail", "speakeasy", "rooftop bar", "wine bar"):
            if kw in name:
                return True
        return False

    for d, items in by_day.items():
        geo_items = [i for i in items if i.get("latitude") and i.get("longitude")]
        if len(geo_items) < 2:
            # Even for 1-item days, fix a nightlife item stuck at 10:00.
            for it in items:
                if _is_nightlife(it):
                    it["time_slot"] = "20:00"
            continue

        # Separate nightlife from daytime items BEFORE nearest-neighbor —
        # we want night spots at the tail regardless of how close they
        # are to the last daytime stop.
        night_items = [i for i in geo_items if _is_nightlife(i)]
        day_geo_items = [i for i in geo_items if not _is_nightlife(i)]

        # Save the original time_slot sequence BEFORE shuffling so we can
        # reassign them to the new positions.
        original_time_slots = [i.get("time_slot") for i in items]

        if day_geo_items:
            # Start with the item that had the earliest time_slot (morning
            # anchor). This mimics "start the day at Casa Rosada" even if a
            # nearby café was technically the closest to the centroid.
            def _slot_key(item: dict) -> str:
                ts = item.get("time_slot") or "99:99"
                return ts
            start_item = min(day_geo_items, key=_slot_key)
            ordered = [start_item]
            remaining = [i for i in day_geo_items if i is not start_item]

            while remaining:
                last = ordered[-1]
                last_lat = float(last["latitude"])
                last_lng = float(last["longitude"])
                nearest_idx = 0
                nearest_dist = float("inf")
                for idx, candidate in enumerate(remaining):
                    dist = _haversine_km(
                        last_lat, last_lng,
                        float(candidate["latitude"]), float(candidate["longitude"]),
                    )
                    if dist < nearest_dist:
                        nearest_dist = dist
                        nearest_idx = idx
                ordered.append(remaining.pop(nearest_idx))
        else:
            ordered = []

        non_geo = [i for i in items if not i.get("latitude") or not i.get("longitude")]
        # Final order: daytime route first, then nightlife, then unmapped.
        new_sequence = ordered + night_items + non_geo

        # Reassign time_slots by position — daytime items use the
        # standard rhythm, nightlife items get pinned evening slots.
        num_day = len(ordered)
        for idx, item in enumerate(new_sequence):
            if _is_nightlife(item):
                night_idx = idx - num_day
                if 0 <= night_idx < len(evening_slots):
                    item["time_slot"] = evening_slots[night_idx]
                else:
                    item["time_slot"] = "22:00"
            elif idx < len(default_time_slots):
                item["time_slot"] = default_time_slots[idx]
            elif idx < len(original_time_slots) and original_time_slots[idx]:
                item["time_slot"] = original_time_slots[idx]

        by_day[d] = new_sequence

    # Rebuild flat list
    result = []
    for d in sorted(by_day.keys()):
        result.extend(by_day[d])

    return result


def _day_has_full_day_activity(items: list[dict]) -> bool:
    """Check if a day contains a full-day activity (theme park, day trip, etc.)."""
    return any(
        (item.get("duration_minutes") or 0) >= 360
        for item in items
    )


def _enforce_main_city_on_early_days(
    place_list: list[dict],
    num_days: int,
    preplanned_day_places: dict[int, set[str]] | None = None,
) -> list[dict]:
    """Regra #1 — Dia 1 + Dia 2 devem estar na cidade principal.

    Strategy: compute the geographic centroid of all places. Any day whose
    own centroid sits >35km from the overall centroid is flagged as a
    day-trip day. If that day-trip landed on Day 1 or Day 2 AND the video
    didn't explicitly place it there (preplanned_day_places), swap it with
    the latest non-daytrip day (usually Day 3+).

    Skipped when:
    - fewer than 3 days (no swap target)
    - video explicitly put the day trip early (Regra #0 wins)
    - not enough geocoded places to compute centroids reliably
    """
    if not place_list or num_days < 3:
        return place_list

    # Group by day with coordinates
    by_day: dict[int, list[dict]] = {}
    for p in place_list:
        d = p.get("day", 1)
        by_day.setdefault(d, []).append(p)

    def _centroid(items: list[dict]) -> tuple[float, float] | None:
        coords = [
            (p["latitude"], p["longitude"])
            for p in items
            if isinstance(p.get("latitude"), (int, float))
            and isinstance(p.get("longitude"), (int, float))
        ]
        if not coords:
            return None
        return (
            sum(c[0] for c in coords) / len(coords),
            sum(c[1] for c in coords) / len(coords),
        )

    def _dist_km(a: tuple[float, float], b: tuple[float, float]) -> float:
        # Haversine
        import math
        lat1, lon1 = map(math.radians, a)
        lat2, lon2 = map(math.radians, b)
        dlat = lat2 - lat1
        dlon = lon2 - lon1
        h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
        return 2 * 6371 * math.asin(math.sqrt(h))

    # Compute each day's centroid
    day_centroid: dict[int, tuple[float, float]] = {}
    for d, items in by_day.items():
        c = _centroid(items)
        if c:
            day_centroid[d] = c
    if len(day_centroid) < 3:
        return place_list

    def _main_centroid_excluding(exclude_day: int) -> tuple[float, float] | None:
        """Main-city centroid = median across all days EXCEPT the one we
        are evaluating. Prevents a day-trip day from pulling the centroid
        toward itself and masking the fact that it's an outlier."""
        others = [c for d, c in day_centroid.items() if d != exclude_day]
        if len(others) < 2:
            return None
        lats = sorted(c[0] for c in others)
        lons = sorted(c[1] for c in others)
        mid = len(others) // 2
        return (lats[mid], lons[mid])

    # Flag early days whose distance to the other-days-median exceeds threshold
    DAYTRIP_KM = 20.0  # >20km from the main-city centroid = day trip
    early_daytrip_days: list[int] = []
    day_distances: dict[int, float] = {}
    for d in (1, 2):
        if d not in day_centroid:
            continue
        mc = _main_centroid_excluding(d)
        if not mc:
            continue
        dist = _dist_km(day_centroid[d], mc)
        day_distances[d] = dist
        if dist > DAYTRIP_KM:
            early_daytrip_days.append(d)
    if not early_daytrip_days:
        return place_list

    # Respect Regra #0 — if the video explicitly placed that day as-is, skip.
    preplanned_day_places = preplanned_day_places or {}

    for early_day in early_daytrip_days:
        early_items = by_day.get(early_day, [])
        early_names = {p.get("name", "").strip().lower() for p in early_items}
        locked = preplanned_day_places.get(early_day, set())
        locked_lower = {n.strip().lower() for n in locked}
        # If majority of early_day's items are in the video's preplanned list,
        # it means the user explicitly wanted this day trip early — honor it.
        if locked_lower and len(early_names & locked_lower) >= len(early_names) * 0.5:
            logger.info(
                "[main-city] Day %d is a day trip (%.1fkm from main) but "
                "video explicitly placed it — keeping per Regra #0.",
                early_day, day_distances[early_day],
            )
            continue

        # Find the latest day (3+) that IS within the main city cluster.
        # Compute each candidate's distance using the same exclude-self rule.
        candidate_days: list[int] = []
        for d in sorted(by_day.keys(), reverse=True):
            if d < 3 or d not in day_centroid:
                continue
            mc = _main_centroid_excluding(d)
            if mc and _dist_km(day_centroid[d], mc) <= DAYTRIP_KM:
                candidate_days.append(d)
        if not candidate_days:
            logger.warning(
                "[main-city] Day %d looks like a day trip (%.1fkm) but no "
                "Day 3+ available to swap with — leaving as-is.",
                early_day, day_distances[early_day],
            )
            continue

        swap_day = candidate_days[0]
        logger.warning(
            "[main-city] Day %d is a day trip (%.1fkm from main city) — "
            "swapping with Day %d to enforce Regra #1.",
            early_day, day_distances[early_day], swap_day,
        )
        # Perform the swap
        for p in by_day[early_day]:
            p["day"] = swap_day
        for p in by_day[swap_day]:
            p["day"] = early_day
        by_day[early_day], by_day[swap_day] = by_day[swap_day], by_day[early_day]
        # Update distances so subsequent iterations see the swap
        day_distances[early_day], day_distances[swap_day] = (
            day_distances.get(swap_day, 0),
            day_distances.get(early_day, 0),
        )

    # Flatten back preserving day order
    result: list[dict] = []
    for d in range(1, num_days + 1):
        result.extend(by_day.get(d, []))
    return result


def _rebalance_days(
    place_list: list[dict],
    num_days: int,
    day_rigidity: dict[int, str] | None = None,
) -> list[dict]:
    """Ensure every day has at least 4 places, unless it has a full-day activity.

    Phase 3: respects `day_rigidity`:
      - locked days never donate or receive items
      - partially_flexible days can receive but never donate (seed items are
        the reason they're partially_flexible)
      - flexible days behave as before
    """
    if not place_list or num_days < 1:
        return place_list

    day_rigidity = day_rigidity or {}

    # Count items per day
    by_day: dict[int, list[dict]] = {}
    for p in place_list:
        d = p.get("day", 1)
        if d < 1 or d > num_days:
            d = 1
            p["day"] = d
        by_day.setdefault(d, []).append(p)

    def _is_locked(d: int) -> bool:
        return day_rigidity.get(d, "flexible") == "locked"

    # Find thin days, but SKIP days with full-day activities AND skip locked
    # days (they intentionally have the count the video dictated).
    empty_days = [
        d for d in range(1, num_days + 1)
        if d not in by_day or len(by_day[d]) == 0
        if not _is_locked(d)
    ]
    thin_days = [
        d for d in range(1, num_days + 1)
        if d in by_day and 0 < len(by_day[d]) < 4
        and not _day_has_full_day_activity(by_day[d])
        and not _is_locked(d)
    ]

    if not empty_days and not thin_days:
        return place_list  # Already balanced

    logger.warning(
        "[rebalance] Unbalanced itinerary detected: empty_days=%s thin_days=%s (locked days skipped)",
        empty_days, thin_days,
    )

    # Find days with excess items (>4) to steal from. Locked + partially_flexible
    # days are forbidden donors — their item set is the video's intent.
    for problem_day in empty_days + thin_days:
        needed = 4 - len(by_day.get(problem_day, []))
        if needed <= 0:
            continue

        donors = sorted(
            [
                (d, items) for d, items in by_day.items()
                if len(items) > 4 and day_rigidity.get(d, "flexible") == "flexible"
            ],
            key=lambda x: -len(x[1]),
        )

        for donor_day, donor_items in donors:
            if needed <= 0:
                break
            # Move items from end of donor day (lowest priority) to the thin day
            # NEVER move link-sourced items — they come from the user's planned itinerary
            while len(donor_items) > 4 and needed > 0:
                # Find the last AI-sourced item to move (preserve link items)
                move_idx = None
                for idx in range(len(donor_items) - 1, -1, -1):
                    if donor_items[idx].get("source") != "link":
                        move_idx = idx
                        break
                if move_idx is None:
                    break  # All remaining items are from links — don't move them
                moved = donor_items.pop(move_idx)
                moved["day"] = problem_day
                by_day.setdefault(problem_day, []).append(moved)
                needed -= 1

    # Rebuild flat list
    result = []
    for d in range(1, num_days + 1):
        result.extend(by_day.get(d, []))

    logger.info("[rebalance] After rebalancing: %s", {d: len(items) for d, items in by_day.items()})
    return result


async def _suggest_destination_experiences(
    destination: str,
    existing_items: list[dict],
    num_days: int,
    cost: CostTracker,
    day_rigidity: dict[int, str] | None = None,
    max_suggestions: int = 4,
    video_day_mentions: dict[int, list[str]] | None = None,
) -> list[dict]:
    """Ask Haiku for the signature experiences every tourist does in this
    destination — things like "show de tango" in Buenos Aires, "passeio
    de Vespa pelo centro histórico" in Rome, "passeio de buggy pelas
    dunas" in Jericoacoara, "boat tour ao redor da ilha" in Capri.

    These are deliberately LOCATION-AGNOSTIC activities — they're about
    what you DO in the city, not where exactly on the map. Google Places
    can't easily pin them (a tango show happens in many venues); so the
    backend emits them as `category=activity` items with `vibe_tag
    "experiencia"` and lets the downstream experience-recommendations
    helper attach venue suggestions.

    Called automatically during build (for any flexible day) and on demand
    via the /enrich-experiences/:trip_id endpoint (for existing trips).
    """
    if not destination or num_days < 1:
        return []

    # Don't suggest things the itinerary already has.
    existing_names_lower = {
        (p.get("name") or "").strip().lower() for p in existing_items
    }

    day_rigidity = day_rigidity or {}
    flexible_days = [
        d for d in range(1, num_days + 1)
        if day_rigidity.get(d, "flexible") == "flexible"
    ]
    if not flexible_days:
        logger.info(
            "[experiences] All %d days locked — skipping experience suggestions",
            num_days,
        )
        return []

    # Group what's already on each day so Haiku can see distribution +
    # match themes (tango → day with San Telmo / nightlife; boat → day
    # with Puerto Madero / waterfront). This is the core concierge brain
    # — experiences can't land on random days anymore.
    items_by_day: dict[int, list[dict]] = {}
    for it in existing_items:
        d = it.get("day") or it.get("day_number")
        if isinstance(d, int):
            items_by_day.setdefault(d, []).append(it)

    day_summary_lines: list[str] = []
    for d in range(1, num_days + 1):
        rigidity = day_rigidity.get(d, "flexible")
        items_on_day = items_by_day.get(d, [])
        names = ", ".join(i.get("name", "?") for i in items_on_day) or "(vazio)"
        count = len(items_on_day)
        tag = "LOCKED" if rigidity == "locked" else "flexível"
        day_summary_lines.append(
            f"  Dia {d} [{tag}, {count} itens]: {names}"
        )
    day_summary = "\n".join(day_summary_lines)

    # How many experiences ALREADY exist on each day (so we don't double-stack).
    existing_exp_per_day: dict[int, int] = {}
    for it in existing_items:
        d = it.get("day") or it.get("day_number")
        tags = it.get("vibe_tags") or []
        if isinstance(d, int) and "experiencia" in tags:
            existing_exp_per_day[d] = existing_exp_per_day.get(d, 0) + 1

    cap_per_day = ", ".join(
        f"Dia {d}: já tem {existing_exp_per_day[d]} experiência(s) — evite"
        for d in existing_exp_per_day
    ) or "(nenhuma)"

    # Optional: video theme map
    video_hint = ""
    if video_day_mentions:
        lines = []
        for day_num in sorted(video_day_mentions.keys()):
            names = video_day_mentions[day_num]
            if names:
                lines.append(f"  Dia {day_num}: {', '.join(names)}")
        if lines:
            video_hint = (
                "\n\nCONTEXTO DO VÍDEO (dias → lugares/menções):\n"
                + "\n".join(lines)
            )

    prompt = f"""Você é um concierge de viagem experiente montando um roteiro
para {destination}. Seu trabalho NÃO é listar experiências aleatórias — é
DISTRIBUIR experiências nos dias certos do jeito que um concierge
profissional faria, considerando tema, ritmo, bairro e o que a pessoa já
tem planejado em cada dia.

═══ ESTADO ATUAL DO ROTEIRO ═══
{day_summary}

Experiências já adicionadas por dia: {cap_per_day}
{video_hint}

═══ SUA TAREFA ═══
Sugira 3-5 experiências ASSINATURA de {destination} e coloque cada uma
no DIA CORRETO. Pense como concierge, não como quem faz lista aleatória.

Exemplos do nível esperado por destino:
- Buenos Aires: show de tango, aula de tango, passeio de barco pelo Rio da Prata, jantar com parrilla
- Roma: passeio de Vespa, tour gastronômico de Trastevere, aperitivo ao pôr do sol no Gianicolo
- Capri: passeio de barco ao redor da ilha, Gruta Azul, jantar em Marina Piccola
- Jericoacoara: buggy dia inteiro nas dunas, cavalgada na praia, pôr do sol na Duna do Pôr do Sol
- Kyoto: cerimônia do chá, caminhada noturna em Gion, experiência de kimono
- Marrakech: jantar em riad, passeio de camelo, hammam tradicional

═══ REGRAS DURAS (NÃO QUEBRAR) ═══
1. **UMA experiência por dia, no máximo.** Nunca duas experiências no mesmo
   dia. Se você propor 4 experiências e só tem 3 dias flexíveis, sugira só 3.
2. **Dias disponíveis (flexíveis): {flexible_days}.** NÃO use dias LOCKED.
3. **Evite dias que já têm experiência** (ver cap_per_day acima).
4. **Case o TEMA com o que já está no dia:**
   - Show de tango → dia com San Telmo / La Boca / vida noturna / bairros tradicionais.
   - Passeio de barco → dia com Puerto Madero / Tigre / costa.
   - Food tour → dia com mercado / bairro gastronômico.
   - Aula de culinária → dia mais relaxado (não empilhe com day trip).
   - Bate-volta de buggy → dia inteiro (não coloque outra coisa no dia).
5. **Hora do dia respeita o tipo:**
   - Boat tours, aulas, tours de manhã → 09:30-10:30.
   - Food tour → 18:00-19:30 (tipicamente começa no fim da tarde).
   - Shows de tango, milongas → 21:00-22:30.
   - Pôr do sol → estime para o destino + mês.
6. **Distribua.** Se houver 5 dias flexíveis e 3 experiências, coloque
   nos dias 1, 3, 5 (ou similar) — não todos no dia 3.
7. **Não duplique** o que já está listado (`existing_names_lower`).

═══ SAÍDA ═══
Retorne APENAS um array JSON:
[{{"name": "Nome da experiência (ex: Show de tango em milonga tradicional)", "category": "activity", "day": <um dos: {flexible_days}>, "time_slot": "HH:MM", "duration_minutes": <60-360>, "description": "2 frases em pt-BR explicando por que é imperdível.", "notes": "Dica prática em pt-BR.", "vibe_tags": ["experiencia", "cultural"]}}]

Nomes concretos em pt-BR, 3-5 items máximo, UM por dia. Acentos certos."""

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    try:
        response = await asyncio.wait_for(
            asyncio.to_thread(
                lambda: client.messages.create(
                    model="claude-haiku-4-5-20251001",
                    max_tokens=2500,
                    messages=[{"role": "user", "content": prompt}],
                    timeout=25.0,
                )
            ),
            timeout=30.0,
        )
        cost.record_usage(response.usage)
        raw = response.content[0].text if response.content else "[]"
    except asyncio.TimeoutError:
        logger.warning("[experiences] TIMED OUT for %s, skipping", destination)
        return []
    except Exception as e:
        logger.warning("[experiences] Call failed for %s: %s", destination, e)
        return []

    parsed = _parse_json_response(raw)
    if not isinstance(parsed, list):
        return []

    # Post-filter: enforce max 1 experience per day. Haiku occasionally
    # stacks 3 experiences on the same day despite the prompt. When that
    # happens, the first candidate wins the day, the rest get pushed to
    # the next-emptiest flexible day. If there's no flexible day left
    # (all days already have an experience from this batch OR from
    # pre-existing items), drop the extra — better to ship 2 well-placed
    # experiences than 4 clustered.
    used_days = set(existing_exp_per_day.keys())

    def _pick_day(requested: int) -> int | None:
        """Return requested if it's free; otherwise pick the flexible
        day with the fewest items (tie-break: lowest number). None if
        every flexible day already has an experience."""
        if requested in flexible_days and requested not in used_days:
            return requested
        available = [d for d in flexible_days if d not in used_days]
        if not available:
            return None
        # Prefer day with least items → spreads load
        available.sort(key=lambda d: (len(items_by_day.get(d, [])), d))
        return available[0]

    suggestions: list[dict] = []
    for item in parsed[:max_suggestions]:
        if not isinstance(item, dict) or not item.get("name"):
            continue
        name = str(item["name"]).strip()
        if name.lower() in existing_names_lower:
            continue
        raw_day = item.get("day")
        requested_day = raw_day if isinstance(raw_day, int) else flexible_days[0]
        day = _pick_day(requested_day)
        if day is None:
            logger.info(
                "[experiences] Skipping %r — no flexible day available for another experience",
                name,
            )
            continue
        if day != requested_day:
            logger.info(
                "[experiences] Moving %r from Day %d → Day %d (day already had an experience)",
                name, requested_day, day,
            )
        used_days.add(day)
        suggestions.append({
            "day": day,
            "name": name,
            "category": "activity",
            "time_slot": item.get("time_slot") or "15:00",
            "duration_minutes": int(item.get("duration_minutes") or 120),
            "description": str(item.get("description") or ""),
            "notes": str(item.get("notes") or ""),
            "vibe_tags": list(item.get("vibe_tags") or ["experiencia"]),
            "alerts": [],
            "source": "ai",
            "_is_experience": True,  # triggers venue recs in validate_one
        })
    logger.info(
        "[experiences] Added %d destination experiences for %s",
        len(suggestions), destination,
    )
    return suggestions


async def _audit_landmark_coverage(
    place_list: list[dict],
    destination: str,
    num_days: int,
    cost: CostTracker,
    day_rigidity: dict[int, str] | None = None,
) -> list[dict]:
    """Ask Haiku to identify missing top landmarks and return them as additional items.

    This is a lightweight safety net — a short, focused prompt that catches
    any iconic landmarks the main generation + verification steps missed.

    Phase 3: respects `day_rigidity`. Landmarks may only be injected into
    `flexible` days. If the only days available for a missing landmark are
    `locked`, the landmark is dropped (not silently added) and logged — the
    Rails day_plan.conflict_alerts will surface this to the UI later.
    """
    if not place_list or not destination:
        return place_list

    day_rigidity = day_rigidity or {}
    flexible_days = [
        d for d in range(1, num_days + 1)
        if day_rigidity.get(d, "flexible") == "flexible"
    ]
    # If EVERY day is locked the audit can't help — skip entirely.
    if not flexible_days:
        logger.info(
            "[audit] Skipping: all %d days are locked/partially_flexible — "
            "no room for landmark injection.", num_days,
        )
        return place_list

    place_names = [p.get("name", "") for p in place_list if p.get("name")]
    names_str = ", ".join(place_names)

    allowed_days_str = ", ".join(str(d) for d in flexible_days)
    prompt = f"""You are a travel expert. Given this itinerary for {destination} with these places:
{names_str}

List the top iconic landmarks of {destination} that are MISSING from this itinerary.
These are places SO famous that a first-time visitor MUST see them — they appear on every postcard and travel guide.

If the itinerary already covers the main landmarks well, return an empty JSON array: []

If landmarks are missing, return a JSON array with up to 5 missing landmark objects:
[{{"day": <must be one of: {allowed_days_str}>, "name": "Exact Place Name", "category": "attraction", "time_slot": "15:00", "duration_minutes": 90, "description": "Why this is unmissable (in Brazilian Portuguese with proper accents).", "notes": "Practical tip (in Brazilian Portuguese).", "vibe_tags": ["cultural", "instagramavel"], "alerts": [], "source": "ai"}}]

RULES:
- Only include places that are genuinely iconic and unmissable for {destination}.
- Days {allowed_days_str} are the ONLY flexible days — DO NOT assign landmarks to other days.
- Write description and notes in PERFECT Brazilian Portuguese with accents (á, é, ã, ç, etc.).
- Return ONLY the JSON array, nothing else."""

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    try:
        response = await asyncio.wait_for(
            asyncio.to_thread(
                lambda: client.messages.create(
                    model="claude-haiku-4-5-20251001",
                    max_tokens=4000,
                    messages=[{"role": "user", "content": prompt}],
                    timeout=30.0,
                )
            ),
            timeout=35.0,
        )
        cost.record_usage(response.usage)
        raw = response.content[0].text if response.content else "[]"
    except asyncio.TimeoutError:
        logger.warning("[audit] Landmark audit TIMED OUT, skipping")
        return place_list
    except Exception as e:
        logger.warning("[audit] Landmark audit call failed, skipping: %s", e)
        return place_list

    parsed = _parse_json_response(raw)
    if not isinstance(parsed, list):
        logger.info("[audit] Landmark audit returned non-list, skipping")
        return place_list

    if len(parsed) == 0:
        logger.info("[audit] Landmark audit: coverage is adequate, no additions needed")
        return place_list

    # Cap at 5 additions
    additions = parsed[:5]

    # Validate additions have required fields + enforce day_rigidity.
    valid_additions = []
    rejected_locked: list[tuple[str, int]] = []
    for item in additions:
        if not isinstance(item, dict) or not item.get("name") or not item.get("day"):
            continue
        day = item.get("day", 1)
        if not isinstance(day, int) or day < 1 or day > num_days:
            day = flexible_days[0] if flexible_days else 1
            item["day"] = day
        # Enforce rigidity — redirect or reject if the day is not flexible.
        if day_rigidity.get(day, "flexible") != "flexible":
            # Try to redirect to a flexible day.
            if flexible_days:
                item["day"] = flexible_days[0]
                logger.info(
                    "[audit] Redirecting landmark %r from locked day %d to flexible day %d",
                    item.get("name"), day, flexible_days[0],
                )
            else:
                rejected_locked.append((item.get("name"), day))
                continue
        # Ensure source is set
        item["source"] = "ai"
        valid_additions.append(item)

    if valid_additions:
        added_names = [a["name"] for a in valid_additions]
        logger.info("[audit] Adding %d missing landmarks: %s", len(valid_additions), added_names)
        place_list.extend(valid_additions)
    else:
        logger.info("[audit] No valid landmark additions")

    if rejected_locked:
        logger.warning(
            "[audit] Rejected %d landmarks targeting locked days (no flexible day available): %s",
            len(rejected_locked), rejected_locked,
        )

    return place_list


async def _call_claude_for_itinerary(
    prompt: str,
    cost: CostTracker,
    expected_items: int = 0,
    num_days: int = 0,
) -> list[dict] | None:
    """Call Claude Sonnet to generate the itinerary place list (Eco mode).

    Retry once if either:
      - fewer than 60% of expected_items returned, OR
      - fewer than all days are covered (user asked for N days, got <N).
    """
    # Dynamic timeout scales with trip length. Sonnet emits ~50 tokens/sec
    # and each day with 5 items ≈ 750 output tokens. Measured timings:
    #   - 3-day trip (~15 items)  → ~15k tokens total → 30s
    #   - 5-day trip (~25 items)  → ~20k tokens total → 45s
    #   - 7-day trip (~35 items)  → ~28k tokens total → 65s
    #   - 10-day trip (~50 items) → ~38k tokens total → 90s
    #   - 15-day trip (~75 items) → ~55k tokens total → 150s+
    # With the classifier → canonical_days → activity_hints chain landing,
    # the prompt is now 2-3x richer for structured D-category videos (multi-
    # base trips with 15 locked days + hints per day). That extra context
    # makes Sonnet think harder and take longer. Measured after that change:
    #   - 15-day Thailand multi_base → ~200-230s
    # So: base 80s + 10s/day, clamped to [60s, 300s]. max_tokens also scales.
    effective_days = max(1, num_days or 5)
    asyncio_timeout = min(300.0, 80.0 + 10.0 * effective_days)
    httpx_timeout = asyncio_timeout - 5.0  # SDK-level timeout 5s under outer
    # max_tokens sized per trip; keep headroom for pt-BR verbosity.
    per_day_tokens = 900  # ~5 items/day × 180 tokens each in pt-BR
    scaled_max_tokens = max(6000, min(24000, 2000 + effective_days * per_day_tokens))

    # max_retries=0 disables the SDK's built-in exponential-backoff retries
    # on 429/5xx/network blips. Those retries compound silently and can eat
    # our entire outer budget — we saw them fire twice in production logs
    # right before a 65s timeout, meaning the SDK spent ~15s of our budget
    # on its own reattempts. We'd rather fail fast and let the USER retry
    # (which clears caches anyway) than have hidden retries pile up.
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key, max_retries=0)

    logger.info(
        "[eco] Sonnet call starting — num_days=%d asyncio_timeout=%.0fs max_tokens=%d",
        effective_days, asyncio_timeout, scaled_max_tokens,
    )

    try:
        response = await asyncio.wait_for(
            asyncio.to_thread(
                lambda: client.messages.create(
                    model="claude-sonnet-4-20250514",
                    max_tokens=scaled_max_tokens,
                    messages=[{"role": "user", "content": prompt}],
                    timeout=httpx_timeout,
                )
            ),
            timeout=asyncio_timeout,
        )
        cost.record_usage(response.usage)
        raw = response.content[0].text if response.content else "[]"
    except asyncio.TimeoutError:
        logger.error(
            "[eco] Sonnet itinerary call TIMED OUT after %.0fs (num_days=%d) — "
            "no retry, failing build", asyncio_timeout, effective_days,
        )
        return None
    except Exception as e:
        logger.error("[eco] Claude itinerary call failed: %s", e)
        return None

    parsed = _parse_json_response(raw)
    if not isinstance(parsed, list):
        logger.error("[eco] Failed to parse response as list. Raw (first 500): %s", raw[:500])
        return None

    covered = {p.get("day") for p in parsed if isinstance(p.get("day"), int)}
    logger.info(
        "[eco] Sonnet returned %d places across %d/%d days (expected %d items)",
        len(parsed), len(covered), num_days, expected_items,
    )
    # Accept ANY non-empty result. Shipping what we have beats timing out.
    return parsed if parsed else None


# ──────────────────────────────────────────────
# CAMADA 2 — Destination-type classifier
# ──────────────────────────────────────────────

DESTINATION_TYPES = {
    "walkable_urban",     # Paris, Rome, Madrid — neighborhood-based walkable cities
    "urban_excursion",    # Buenos Aires+Tigre, Lisbon+Sintra — city + day trips
    "tour_driven",        # Atacama, Jericoacoara, parts of Thailand — built around operator tours
    "multi_base",         # Thailand 15d, Italy multi-city, Japan — multiple bases with transfers
}


async def _classify_destination(
    country: str,
    cities: list[str],
    num_days: int,
    content_sample: str,
    cost: CostTracker,
) -> dict | None:
    """Classify the destination's planning model via one Haiku call.

    Returns a dict like::

        {
          "destination_type": "multi_base",
          "reasoning": "Thailand for 15 days is almost always multi-base...",
          "base_cities": ["Bangkok", "Chiang Mai", "Phuket"],
          "tour_dominant": true,
          "planning_notes": [
            "Island hopping days are operator boat tours, not single pins",
            "Allow transfer days between bases",
            ...
          ]
        }

    The result is stored in `traveler_profile.destination_classification`
    and read by `_build_itinerary_prompt` to pick the right planning model.

    Failure is non-fatal — we fall back to `walkable_urban` so the build
    still works, just without destination-aware tuning.
    """
    if not country and not cities:
        logger.info("[dest-type] Skipping — no country or cities available")
        return None

    sample = (content_sample or "")[:1500]
    cities_str = ", ".join(cities) if cities else "unknown"

    prompt = f"""You are an expert travel planner. Classify this destination's PLANNING MODEL so a downstream itinerary engine knows how to structure the trip.

Destination:
  country: {country or "unknown"}
  cities mentioned: {cities_str}
  trip length: {num_days} days

Sample of the user's source content:
{sample}

Classify into EXACTLY ONE of:

  1. walkable_urban — compact city where most attractions are walkable pins in neighborhoods.
     Examples: Paris, Rome, Madrid, Barcelona, Lisbon, Amsterdam, Prague.

  2. urban_excursion — base city plus ONE or TWO prominent day trips.
     Examples: Buenos Aires + Tigre, Lisbon + Sintra, Santiago + Valparaíso,
     Florence + Tuscany villages.

  3. tour_driven — destination built around OPERATOR-LED tours (boat, desert,
     island hopping, safari, excursion packages). Attractions aren't free-
     walkable pins; most days are a booked excursion.
     Examples: Atacama, Jericoacoara, Maldives, Galápagos, many Thai island
     segments, Egypt Nile cruise, safari in Kenya.

  4. multi_base — trip uses MULTIPLE base cities, each with its own logic,
     connected by transfer days.
     Examples: Thailand 10-15d (Bangkok + Chiang Mai + Phuket), Italy
     multi-city (Rome + Florence + Venice), Japan (Tokyo + Kyoto + Osaka).

Rules:
  - A 15-day Thailand trip is ALMOST ALWAYS multi_base (even if only Bangkok
    is mentioned — the user needs help splitting those days).
  - A single-city trip under 7 days is almost never multi_base.
  - If the content explicitly mentions boat tours, island hopping, desert
    excursions, safari, or operator-booked days, lean tour_driven.
  - Urban + 1-2 day trips = urban_excursion. Urban + 3+ bases = multi_base.

CRITICAL — base_cities MUST be specific, real, named cities:
  ✅ GOOD: "Bangkok", "Chiang Mai", "Phuket", "Krabi", "Ko Samui"
  ❌ BAD:  "Northern Thailand", "Southern Thailand", "Tailândia do Norte",
           "Beach Region", "Mountain Area", "Highlands", "Coast"
  - Never use regional or compass-direction labels. Pick the actual city
    the traveler bases in (the town where they sleep and start each day).
  - If the source content names a region without a city, pick the obvious
    hub city for that region (e.g. "Northern Thailand" → "Chiang Mai"
    unless content specifies otherwise; "Tuscany" → "Florence" or "Siena"
    depending on what's mentioned).
  - Names should be in the traveler's likely language (Portuguese speakers
    see "Bangkok" not "Banguecoque"; English names are acceptable for
    Thai/Japanese cities where no PT name is common).

Return ONLY a JSON object:
{{
  "destination_type": "walkable_urban" | "urban_excursion" | "tour_driven" | "multi_base",
  "reasoning": "one-sentence why (English)",
  "base_cities": ["SpecificCity1", "SpecificCity2"],
  "tour_dominant": true | false,
  "planning_notes": [
    "short actionable planning hint 1",
    "short actionable planning hint 2",
    "..."
  ]
}}

planning_notes should be 3-6 concrete hints specific to THIS destination and trip length — things the itinerary engine should remember (e.g., "Phi Phi + Maya Bay are typically done as a single full-day boat tour from Phuket or Krabi", "reserve transfer days between Bangkok and Chiang Mai"). They'll be injected into the generation prompt."""

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key, max_retries=0)

    try:
        response = await asyncio.wait_for(
            asyncio.to_thread(
                lambda: client.messages.create(
                    model="claude-haiku-4-5-20251001",
                    max_tokens=1200,
                    messages=[{"role": "user", "content": prompt}],
                    timeout=15.0,
                )
            ),
            timeout=20.0,
        )
        cost.record_usage(response.usage)
        raw = response.content[0].text if response.content else "{}"
    except asyncio.TimeoutError:
        logger.warning("[dest-type] Classifier timed out — defaulting to walkable_urban")
        return None
    except Exception as e:
        logger.warning("[dest-type] Classifier failed: %s", e)
        return None

    parsed = _parse_json_response(raw)
    if not isinstance(parsed, dict):
        logger.warning("[dest-type] Parse failed (%s...)", raw[:200])
        return None

    dtype = parsed.get("destination_type")
    if dtype not in DESTINATION_TYPES:
        logger.warning("[dest-type] Unknown type %r, coercing to walkable_urban", dtype)
        parsed["destination_type"] = "walkable_urban"

    logger.info(
        "[dest-type] %s — %s (bases=%s, tour_dominant=%s)",
        parsed["destination_type"],
        (parsed.get("reasoning") or "")[:100],
        parsed.get("base_cities"),
        parsed.get("tour_dominant"),
    )
    return parsed


# ──────────────────────────────────────────────
# PHASE 0: Extract content (shared by eco + pro)
# ──────────────────────────────────────────────


async def _extract_link(
    link_id: int, trip_id: int, url: str, platform: str, http_client=None,
) -> dict:
    """Phase 0: Extract content from this link only. No AI calls.

    Same for both eco and pro modes. The link is marked as 'extracted' when done.
    The Rails backend detects when ALL links are extracted and triggers Phase 1.
    """
    rails = RailsClient(client=http_client)
    cost = CostTracker(link_id=link_id)

    try:
        await rails.update_link(trip_id, link_id, status="processing")
    except Exception as e:
        logger.error("Failed to mark link %d as processing: %s", link_id, e)

    # Extract content from URL
    logger.info("[eco] Phase 0: Extracting content from %s", url)
    content_text = await _extract_content(url)

    if not content_text.strip():
        await _mark_failed(rails, trip_id, link_id, "No content extracted")
        return {"error": "No content", "places_created": 0}

    # Store extracted content and mark as "extracted"
    try:
        await rails.update_link(
            trip_id, link_id, status="extracted",
            extracted_data={"content_text": content_text[:12000]},
        )
    except Exception as e:
        logger.warning("Failed to store content for link %d: %s", link_id, e)
        await _mark_failed(rails, trip_id, link_id, f"Failed to store content: {e}")
        return {"error": str(e), "places_created": 0}

    logger.info("[eco] Phase 0 complete for link %d — content stored (%d chars)", link_id, len(content_text))
    return {"status": "extracted", "places_created": 0}


async def extract_profile_and_build(trip_id: int, http_client=None) -> dict:
    """Combined pipeline that runs all three phases in sequence:

      1. Extract content from every link on the trip (Whisper + Vision + scrape).
         Sequential per-link to respect Render's 512 MB memory limit.
      2. Profile analysis (Sonnet) → populates traveler_profile, cities_detected,
         places_mentioned. Auto-confirms — there's no user gate any more.
      3. Itinerary build (eco pipeline) — only if `ai_mode != "manual"`.

    This replaces the old split between Rails-triggered /api/process-link
    callbacks and /api/resume-processing. The whole flow runs in ONE
    background task scheduled from /api/extract-and-build, so failure
    handling lives in one place and the user only waits once.

    Returns a result dict with `places_created` (0 for manual mode or
    extraction-only failures) and optional `error`.
    """
    import time as _t
    rails = RailsClient(client=http_client)
    pipeline_start = _t.time()

    def _mark(stage: str) -> None:
        logger.info("[combined t=%.1fs trip=%d] %s", _t.time() - pipeline_start, trip_id, stage)

    # ─── Phase 0: extract content for every link that hasn't been done ─────
    _mark("fetching trip + links")
    try:
        trip = await rails.get_trip(trip_id)
    except Exception as e:
        logger.error("[combined] Failed to fetch trip %d: %s", trip_id, e)
        return {"error": f"fetch trip: {e}", "places_created": 0}

    ai_mode = trip.get("ai_mode", "eco")
    links = trip.get("links") or []
    if not links:
        try:
            links = await rails.get_links(trip_id)
        except Exception:
            links = []

    pending_links = [
        l for l in links
        if l.get("status") not in ("extracted", "processed")
    ]
    _mark(f"need to extract {len(pending_links)}/{len(links)} link(s) (ai_mode={ai_mode})")

    # Sequential — one link at a time to keep memory under Render's 512 MB.
    # Each link has its own internal 240s timeout (deep extraction).
    for link in pending_links:
        link_id = link.get("id")
        url = link.get("url", "")
        platform = link.get("platform") or "other"
        if not link_id or not url:
            continue
        try:
            await _extract_link(link_id, trip_id, url, platform, http_client=http_client)
            _mark(f"extracted link {link_id}")
        except Exception as e:
            logger.warning("[combined] Link %d extraction failed (continuing): %s", link_id, e)

    # ─── Phase 1: profile analysis (no user gate) ──────────────────────────
    _mark("analyzing profile")
    try:
        profile_result = await analyze_trip(trip_id, http_client=http_client)
        if profile_result.get("error"):
            logger.warning(
                "[combined] Profile analysis returned error (continuing): %s",
                profile_result["error"],
            )
    except Exception as e:
        logger.exception("[combined] Profile analysis raised; continuing without profile")

    # Auto-confirm so the build doesn't expect a user click.
    try:
        await rails.update_trip(trip_id, {"profile_status": "confirmed"})
        _mark("profile auto-confirmed")
    except Exception as e:
        logger.warning("[combined] Failed to auto-confirm profile: %s", e)

    # ─── Camada 2: classify destination planning model ─────────────────────
    # One cheap Haiku call that decides walkable_urban / urban_excursion /
    # tour_driven / multi_base. Result is persisted on the profile and read
    # by _build_itinerary_prompt to pick the right planning approach. Skipped
    # in manual mode (no Sonnet build anyway).
    if ai_mode != "manual":
        try:
            refreshed = await rails.get_trip(trip_id)
            refreshed_profile = refreshed.get("traveler_profile") or {}
            country = (refreshed_profile.get("country_detected") or "").strip()
            cities = refreshed_profile.get("cities_detected") or []
            num_days = int(refreshed.get("num_days") or 0)
            # Build a small content sample from the links so the classifier
            # has something to ground on. Cap at 1500 chars to keep Haiku fast.
            sample_parts: list[str] = []
            for l in (refreshed.get("links") or []):
                ct = ((l.get("extracted_data") or {}).get("content_text") or "")[:600]
                if ct:
                    sample_parts.append(ct)
                if sum(len(p) for p in sample_parts) > 1500:
                    break
            content_sample = "\n".join(sample_parts)
            classify_cost = CostTracker(link_id=0)
            classification = await _classify_destination(
                country=country,
                cities=cities,
                num_days=num_days,
                content_sample=content_sample,
                cost=classify_cost,
            )
            if classification:
                refreshed_profile["destination_classification"] = classification
                dtype = classification.get("destination_type")
                base_cities = [
                    str(c).strip()
                    for c in (classification.get("base_cities") or [])
                    if c and str(c).strip()
                ]

                # STEP 4a — multi_base pause. When the classifier splits the
                # trip across 2+ base cities, ask the user to confirm which
                # cities and how many days each BEFORE we spend Tavily tokens
                # or kick off the Sonnet build. The UI's CityDistributionModal
                # posts to /confirm-city-distribution which flips
                # city_distribution.status to "confirmed" and re-enters this
                # function — the pause check below sees status="confirmed"
                # and falls through to research + build.
                if dtype == "multi_base" and len(base_cities) >= 2:
                    existing_cd = refreshed_profile.get("city_distribution") or {}
                    if existing_cd.get("status") != "confirmed":
                        if not existing_cd:
                            refreshed_profile["city_distribution"] = {
                                "status": "awaiting",
                                "base_cities": base_cities,
                                "selected_cities": list(base_cities),
                                "day_distribution": _proportional_distribution(
                                    num_days, base_cities,
                                ),
                                "num_days": num_days,
                                "created_at": int(_t.time()),
                            }
                        await rails.update_trip(
                            trip_id, {"traveler_profile": refreshed_profile},
                        )
                        _mark(
                            f"multi_base detected ({len(base_cities)} cities) — "
                            "pausing for user distribution"
                        )
                        return {
                            "status": "awaiting_city_distribution",
                            "places_created": 0,
                            "elapsed_s": round(_t.time() - pipeline_start, 1),
                        }

                # STEP 4b — external research only when the destination type
                # actually benefits from it (tour_driven / multi_base). Stored
                # in the profile so _build_itinerary_prompt can inject it. For
                # multi_base this runs AFTER the pause, using only the cities
                # the user confirmed (saves Tavily tokens if they unchecked
                # some of the detected cities).
                if dtype in ("tour_driven", "multi_base") and settings.tavily_api_key:
                    research_cities = cities
                    if dtype == "multi_base":
                        cd = refreshed_profile.get("city_distribution") or {}
                        selected = cd.get("selected_cities") or []
                        if selected:
                            research_cities = selected
                    try:
                        research = await _research_itinerary_patterns(
                            country=country,
                            cities=research_cities,
                            num_days=num_days,
                            destination_type=dtype,
                        )
                        if research:
                            refreshed_profile["external_research"] = research
                            _mark(f"external research gathered ({len(research)} chars)")
                    except Exception:
                        logger.exception("[research] Non-fatal — continuing without external context")

                # STEP 4c — flexible-day research. MANDATORY for any trip
                # with ≥2 days. Policy: "nenhum risco de ir sem" — if
                # Tavily fails (unconfigured, unreachable, all queries
                # empty after retries) the build is blocked with a visible
                # error so the user retries. We do NOT degrade silently
                # to a LLM-only itinerary.
                if num_days >= 2:
                    research_cities_flex = cities
                    if dtype == "multi_base":
                        cd = refreshed_profile.get("city_distribution") or {}
                        selected = cd.get("selected_cities") or []
                        if selected:
                            research_cities_flex = selected
                    interests = (
                        refreshed_profile.get("interests")
                        or refreshed_profile.get("interests_en")
                        or []
                    )
                    flex_approx = max(num_days - 1, 1)
                    flex_research = await _research_flexible_day_places(
                        country=country,
                        cities=research_cities_flex,
                        num_days=num_days,
                        interests=interests,
                        places_mentioned=refreshed_profile.get("places_mentioned") or [],
                        flex_days_count=flex_approx,
                    )
                    # _research_flexible_day_places raises on hard failure,
                    # so reaching here means we got non-empty content.
                    refreshed_profile["external_research_flexible"] = flex_research
                    _mark(f"flexible-day research gathered ({len(flex_research)} chars)")

                await rails.update_trip(
                    trip_id, {"traveler_profile": refreshed_profile},
                )
                _mark(f"destination classified as {classification.get('destination_type')}")
        except FlexibleResearchUnavailable:
            # Mandatory flex research failed — do NOT swallow. This is the
            # whole point of the "nenhum risco de ir sem" policy: the build
            # must abort with a visible error rather than produce a thin
            # LLM-only itinerary. Re-raise so the outer handler persists
            # build_error on the trip and the frontend surfaces it.
            raise
        except Exception:
            logger.exception("[combined] destination classifier failed (non-fatal)")

    # ─── Phase 2: build itinerary (skip in manual mode) ────────────────────
    if ai_mode == "manual":
        _mark("manual mode — skipping itinerary build")
        return {
            "status": "manual_extracted",
            "places_created": 0,
            "elapsed_s": round(_t.time() - pipeline_start, 1),
        }

    # If profile analysis flagged needs_destination AND the trip has no
    # destination, skip the build — the AskDestinationModal in the UI
    # will collect a city, save it on the trip, then re-trigger /build.
    # Without a destination the build picks random places anywhere on
    # earth, which is worse than asking once.
    try:
        refreshed_trip = await rails.get_trip(trip_id)
        refreshed_profile = refreshed_trip.get("traveler_profile") or {}
        if (
            refreshed_profile.get("needs_destination")
            and not (refreshed_trip.get("destination") or "").strip()
        ):
            _mark("needs_destination flagged — pausing build, UI will ask user")
            return {
                "status": "needs_destination",
                "places_created": 0,
                "elapsed_s": round(_t.time() - pipeline_start, 1),
            }
    except Exception:
        # Best-effort check — if the refresh fails, fall through to the
        # build and let it do its best with whatever it can infer.
        pass

    _mark("building itinerary")
    try:
        build_result = await build_trip_itinerary(trip_id, http_client=http_client)
        elapsed = _t.time() - pipeline_start
        _mark(f"DONE in {elapsed:.1f}s — {build_result.get('places_created', 0)} places")
        build_result["elapsed_s"] = round(elapsed, 1)
        return build_result
    except Exception as e:
        logger.exception("[combined] Build raised")
        return {
            "error": f"build: {type(e).__name__}: {str(e)[:200]}",
            "places_created": 0,
            "elapsed_s": round(_t.time() - pipeline_start, 1),
        }


async def analyze_trip(trip_id: int, http_client=None) -> dict:
    """Phase 1: Aggregate ALL extracted content → ONE Haiku call for profile + cities.

    Called by Rails when all links are extracted, or manually via API.
    """
    rails = RailsClient(client=http_client)
    cost = CostTracker(link_id=0)

    try:
        trip = await rails.get_trip(trip_id)
    except Exception as e:
        logger.error("[analyze] Failed to fetch trip %d: %s", trip_id, e)
        return {"error": str(e)}

    destination = trip.get("destination", "")

    # Fetch all links and aggregate their content
    try:
        links = trip.get("links", [])
        if not links:
            # Try fetching links separately
            links = await rails.get_links(trip_id)
    except Exception as e:
        logger.error("[analyze] Failed to fetch links: %s", e)
        return {"error": str(e)}

    # Collect content from all extracted links
    content_parts = []
    for link in links:
        extracted = link.get("extracted_data") or {}
        ct = extracted.get("content_text", "")
        if ct:
            url = link.get("url", "unknown")
            content_parts.append(f"--- Source: {url} ---\n{ct}")

    if not content_parts:
        logger.warning("[analyze] No extracted content found for trip %d", trip_id)
        return {"error": "No extracted content"}

    combined_content = "\n\n".join(content_parts)
    logger.info("[analyze] Phase 1: Analyzing profile from %d sources (%d chars total)",
                len(content_parts), len(combined_content))

    # ONE Haiku call with all content combined
    profile = await _analyze_profile(combined_content, destination, cost)

    if profile:
        # Phase 4 — flag if no city was inferred. The frontend uses this to
        # show an AskDestinationModal because the build can't pick landmarks
        # / Google-Places-validate without knowing the destination. Trip
        # destination is also blank in this case (the user no longer types
        # it in the trip-create form).
        cities = profile.get("cities_detected") or []
        country = (profile.get("country_detected") or "").strip()
        trip_destination = (trip.get("destination") or "").strip()
        profile["needs_destination"] = (
            not cities and not country and not trip_destination
        )

        # GUARD against race-condition regression. extract-and-build and the
        # frontend's own /analyze-trip call can both fire for the same trip
        # in parallel. If one run comes back with a SYNTHESIZED FALLBACK
        # profile (Haiku parse failed → _enrich_weak_profile emits empty
        # cities/country) AND the trip already has a richer profile persisted
        # from a concurrent successful run, writing this one would overwrite
        # the good data with empty cities → frontend sees needs_destination=
        # true → user gets the "Onde é a viagem?" modal even though the
        # classifier had correctly extracted 6 Thailand cities.
        # Rule: never regress cities_detected from N≥2 to 0.
        existing_profile = trip.get("traveler_profile") or {}
        existing_cities = existing_profile.get("cities_detected") or []
        if not cities and len(existing_cities) >= 2:
            logger.warning(
                "[analyze] Skipping profile save — synthesized fallback "
                "would regress cities from %d to 0. Keeping existing profile.",
                len(existing_cities),
            )
            return {
                "status": "confirmed",
                "profile": existing_profile,
                "cost": cost.summary(),
            }

        try:
            # Auto-confirm — the user can edit the profile inline on the trip
            # page now (Phase 3 of the deferred-extraction redesign). No more
            # confirmation modal blocking the build.
            updates = {
                "traveler_profile": profile,
                "profile_status": "confirmed",
            }
            # Auto-set trip.destination to "City, Country" so Google Places
            # searches disambiguate correctly. A plain "Bangkok" can resolve
            # to Bangkok IL, USA; "Bangkok, Thailand" can't. If we only have
            # a country, use that (better than nothing).
            if not trip_destination:
                if cities and country:
                    updates["destination"] = f"{cities[0]}, {country}"
                elif cities:
                    updates["destination"] = cities[0]
                elif country:
                    updates["destination"] = country
            await rails.update_trip(trip_id, updates)
        except Exception as e:
            logger.warning("[analyze] Failed to save profile: %s", e)
            return {"error": str(e)}

        logger.info(
            "[analyze] Phase 1 complete — profile auto-confirmed, country=%s cities=%s needs_destination=%s",
            country, cities, profile["needs_destination"],
        )
        return {
            "status": "confirmed",
            "profile": profile,
            "cost": cost.summary(),
        }
    else:
        # Profile analysis failed — auto-confirm with empty profile and build itinerary directly.
        # The AI can still build a good itinerary from extracted content alone.
        logger.warning("[analyze] Profile analysis failed for trip %d — auto-confirming and building itinerary", trip_id)
        try:
            await rails.update_trip(trip_id, {"profile_status": "confirmed"})
        except Exception:
            pass
        # Trigger itinerary generation immediately (don't leave user stuck)
        try:
            result = await build_trip_itinerary(trip_id, http_client)
            return {"status": "confirmed", "profile": None, "cost": cost.summary(), **result}
        except Exception as e:
            logger.error("[analyze] Auto-build failed for trip %d: %s", trip_id, e)
            return {"status": "confirmed", "profile": None, "cost": cost.summary()}


async def enrich_trip_with_experiences(
    trip_id: int, http_client=None,
) -> dict:
    """Add signature destination experiences to an EXISTING trip.

    Used by the "Adicionar experiências" button for trips that were
    built before _suggest_destination_experiences existed, or trips
    that simply didn't capture tango/boat/buggy/Vespa-type activities
    from the source videos.

    Injects up to 4 experiences onto flexible days, then runs the same
    venue-recommendation pass the build pipeline uses so each new card
    lands with "💡 Onde fazer: Rojo Tango · Café Tortoni · …".

    Safe to call repeatedly — already-present experiences are skipped
    via existing_names_lower.
    """
    rails = RailsClient(client=http_client)
    cost = CostTracker(link_id=0)

    try:
        trip = await rails.get_trip(trip_id)
        day_plans_raw = await rails.get_day_plans(trip_id)
    except Exception as e:
        return {"error": f"Failed to load trip: {e}", "added": 0}

    destination = trip.get("destination") or ""
    if not destination:
        return {"error": "Trip has no destination", "added": 0}

    day_rigidity: dict[int, str] = {}
    dp_by_number: dict[int, int] = {}
    existing_items: list[dict] = []
    video_day_mentions: dict[int, list[str]] = {}
    for dp in day_plans_raw:
        n = dp.get("day_number")
        if isinstance(n, int):
            dp_by_number[n] = dp["id"]
            day_rigidity[n] = dp.get("rigidity") or "flexible"
        day_item_names: list[str] = []
        for it in dp.get("itinerary_items") or []:
            existing_items.append(it)
            name = it.get("name")
            if name:
                day_item_names.append(name)
        if isinstance(n, int) and day_item_names:
            video_day_mentions[n] = day_item_names

    suggestions = await _suggest_destination_experiences(
        destination, existing_items, len(day_plans_raw), cost,
        day_rigidity=day_rigidity,
        video_day_mentions=video_day_mentions,
    )
    if not suggestions:
        return {"added": 0, "summary": "Nenhuma experiência nova para adicionar"}

    # Attach venue recommendations + persist each as a real item.
    created = 0
    for item in suggestions:
        # Reuse the experience-recommendations helper the main pipeline
        # uses so each card lands with "💡 Onde fazer: …" in notes.
        recs = await _experience_recommendations(item["name"], destination, cost)
        if recs:
            item["notes"] = (item.get("notes") or "").strip()
            item["notes"] += (
                ("\n\n" if item["notes"] else "")
                + "💡 Onde fazer: "
                + " · ".join(r["name"] for r in recs[:3])
            )

        dp_id = dp_by_number.get(item["day"])
        if not dp_id:
            continue

        payload = {k: v for k, v in item.items() if not k.startswith("_") and k != "day"}
        payload.setdefault("origin", "ai_suggested")

        try:
            await rails.create_itinerary_item(trip_id, dp_id, payload)
            created += 1
        except Exception as e:
            logger.warning(
                "[experiences] Failed to create %r in day %d: %s",
                item["name"], item["day"], e,
            )

    return {
        "added": created,
        "total_suggested": len(suggestions),
        "summary": f"{created} experiências adicionadas",
    }


async def optimize_trip_routing(trip_id: int, http_client=None) -> dict:
    """Re-run ONLY the routing pass on an existing trip.

    Takes the items exactly as they are today, runs the same geographic
    optimizer the build pipeline uses (_enforce_main_city_on_early_days,
    _tighten_day_clusters skipped since items already validated,
    _optimize_day_proximity), and persists the resulting position +
    time_slot + day changes back to Rails.

    No AI calls. No changes to what's in the trip — only where things sit.
    Fast (a few hundred ms + a handful of PATCHes).
    """
    rails = RailsClient(client=http_client)

    try:
        trip = await rails.get_trip(trip_id)
        day_plans_raw = await rails.get_day_plans(trip_id)
    except Exception as e:
        return {"error": f"Failed to load trip: {e}", "changed": 0}

    # Flatten current items + remember their original (day, position) so
    # we can detect what actually moved.
    place_list: list[dict] = []
    original_state: dict[int, tuple[int, int]] = {}  # item_id -> (day, position)
    dp_by_number: dict[int, int] = {}
    for dp in day_plans_raw:
        day_num = dp.get("day_number")
        dp_by_number[day_num] = dp["id"]
        for idx, it in enumerate(dp.get("itinerary_items") or []):
            place = {**it, "day": day_num}
            place_list.append(place)
            original_state[it["id"]] = (day_num, idx)

    if not place_list:
        return {"changed": 0, "total": 0, "summary": "Trip is empty"}

    num_days = len(day_plans_raw)

    # Re-derive day_rigidity from the persisted day_plan.rigidity so
    # locked days are still protected from inter-day swaps.
    day_rigidity: dict[int, str] = {}
    for dp in day_plans_raw:
        dn = dp.get("day_number")
        if isinstance(dn, int):
            day_rigidity[dn] = dp.get("rigidity") or "flexible"

    # Build the preplanned_day_places set so _enforce_main_city_on_early_days
    # still honors Regra #0.
    profile = trip.get("traveler_profile") or {}
    preplanned_day_places: dict[int, set[str]] = {}
    cc = profile.get("content_classification") or {}
    for k, v in (cc.get("canonical_days") or {}).items():
        try:
            key = int(k)
        except (TypeError, ValueError):
            continue
        if isinstance(v, dict) and v.get("places"):
            preplanned_day_places.setdefault(key, set()).update(v["places"])

    # Run the same two passes used during build. No cluster tightening —
    # these items already passed fence + cluster rules when first created;
    # we don't want to drop anything.
    place_list = _enforce_main_city_on_early_days(
        place_list, num_days, preplanned_day_places=preplanned_day_places,
    )
    place_list = _optimize_day_proximity(place_list, day_rigidity=day_rigidity)

    # Compute new (day, position) for each item and diff against original.
    by_day: dict[int, list[dict]] = {}
    for p in place_list:
        d = p.get("day", 1)
        by_day.setdefault(d, []).append(p)

    slot_by_position = ["10:00", "12:30", "14:30", "16:30", "19:00"]
    _NIGHT_CATS = {"nightlife", "bar", "club", "vida_noturna"}

    def _nightlife_slot_for(item: dict) -> str | None:
        """Return an evening slot if item is nightlife/bar, else None."""
        cat = str(item.get("category") or "").lower()
        name = str(item.get("name") or "").lower()
        is_night = cat in _NIGHT_CATS or any(
            kw in name for kw in ("nightlife", "cocktail", "speakeasy", "rooftop bar", "wine bar")
        )
        return "20:00" if is_night else None

    patches: list[tuple[int, int, int, dict]] = []  # (item_id, new_dp_id, new_pos, data)
    for day_num in sorted(by_day.keys()):
        items = by_day[day_num]
        new_dp_id = dp_by_number.get(day_num)
        if not new_dp_id:
            continue
        for pos, item in enumerate(items):
            item_id = item.get("id")
            if not item_id:
                continue
            orig = original_state.get(item_id)
            if not orig:
                continue
            orig_day, orig_pos = orig
            # Nightlife/bar overrides positional slots — no more "Phi Phi
            # Nightlife @ 14:30". Evening items always get 20:00.
            night_override = _nightlife_slot_for(item)
            if night_override:
                new_slot = night_override
            elif pos < len(slot_by_position):
                new_slot = slot_by_position[pos]
            else:
                new_slot = item.get("time_slot")
            changed_day = orig_day != day_num
            changed_pos = orig_pos != pos
            changed_slot = item.get("time_slot") != new_slot
            if not (changed_day or changed_pos or changed_slot):
                continue
            data: dict = {"position": pos}
            if new_slot:
                data["time_slot"] = new_slot
            # day_plan_id change goes through a MOVE-style PATCH (the
            # controller allows changing day_plan_id on update).
            if changed_day:
                data["day_plan_id"] = new_dp_id
            patches.append((item_id, new_dp_id, pos, data))

    # Persist all patches in parallel. Send each to the ORIGINAL day's
    # endpoint so we don't need a separate move call — the controller
    # handles day_plan_id change on update.
    id_to_original_day = {item_id: orig for item_id, orig in original_state.items()}

    async def _apply_patch(item_id: int, _dp_id: int, _pos: int, data: dict):
        orig = id_to_original_day.get(item_id)
        if not orig:
            return
        orig_day, _ = orig
        orig_dp_id = dp_by_number.get(orig_day)
        if not orig_dp_id:
            return
        try:
            await rails.update_itinerary_item(trip_id, orig_dp_id, item_id, data)
        except Exception as e:
            logger.warning("[optimize] PATCH failed for item %s: %s", item_id, e)

    if patches:
        await asyncio.gather(*[_apply_patch(*p) for p in patches])

    logger.info(
        "[optimize] Trip %d: %d/%d items rearranged",
        trip_id, len(patches), len(place_list),
    )
    return {
        "changed": len(patches),
        "total": len(place_list),
        "summary": (
            "Rota já estava otimizada" if not patches
            else f"{len(patches)} itens reorganizados"
        ),
    }


async def build_trip_itinerary(trip_id: int, http_client=None) -> dict:
    """Phase 2: Build ONE unified itinerary from all link content + confirmed profile.

    Called after user confirms profile (and optionally sets day distribution).
    Emits a [build t=Xs] log line at every major phase boundary so it's
    easy to spot which step is slow in production.
    """
    import time as _time
    _t0 = _time.time()
    def _mark(stage: str) -> None:
        logger.info("[build t=%.1fs] %s", _time.time() - _t0, stage)
        # Update the active_builds registry (best-effort) so
        # /build-status/{trip_id} can report what's happening right now.
        try:
            from app.api.routes import active_builds as _ab
            info = _ab.get(trip_id)
            if info is not None:
                info["stage"] = stage
                info["last_log_at"] = _time.time()
        except Exception:
            pass

    rails = RailsClient(client=http_client)
    places = GooglePlacesClient(http_client=http_client)
    cost = CostTracker(link_id=0)

    _mark("start — fetching trip + day_plans")
    try:
        trip = await rails.get_trip(trip_id)
        day_plans_raw = await rails.get_day_plans(trip_id)
    except Exception as e:
        logger.error("[build] Failed to fetch trip %d: %s", trip_id, e)
        return {"error": str(e), "places_created": 0}

    day_plans = []
    existing_items = []
    for dp in day_plans_raw:
        day_plans.append({
            "id": dp["id"],
            "day_number": dp["day_number"],
            "date": dp.get("date"),
            "city": dp.get("city"),
        })
        for item in dp.get("itinerary_items", []):
            existing_items.append(item.get("name", ""))

    if not day_plans:
        return {"error": "No day plans", "places_created": 0}

    # Apply day distribution if provided (stored in traveler_profile.day_distribution)
    profile = trip.get("traveler_profile") or {}
    day_distribution = profile.get("day_distribution")
    if day_distribution and isinstance(day_distribution, dict):
        await _assign_cities_to_days(rails, trip_id, day_plans, day_distribution)
        # Refresh day_plans after city assignment
        day_plans_raw = await rails.get_day_plans(trip_id)
        day_plans = []
        for dp in day_plans_raw:
            day_plans.append({
                "id": dp["id"],
                "day_number": dp["day_number"],
                "date": dp.get("date"),
                "city": dp.get("city"),
            })

    # Aggregate content from ALL links
    _mark(f"aggregating content from {len(trip.get('links', []))} link(s)")
    links = trip.get("links", [])
    if not links:
        try:
            links = await rails.get_links(trip_id)
        except Exception:
            links = []

    content_parts = []
    source_urls = []
    stale_links: list[dict] = []  # links whose content_text was saved before
                                    # Whisper/Vision/Groq was configured
    for link in links:
        extracted = link.get("extracted_data") or {}
        ct = extracted.get("content_text", "")
        url = link.get("url", "")
        # Re-extract if content is poor (no transcript AND no OCR → likely
        # extracted before deep pipeline was active OR the user's API
        # setup changed since).
        needs_reextract = (
            not ct
            or len(ct) < 600
            or (
                "[TRANSCRIPT]" not in ct
                and "[ON-SCREEN TEXT]" not in ct
            )
        )
        if needs_reextract and url:
            stale_links.append(link)
            continue
        if ct:
            content_parts.append(f"--- Source: {url} ---\n{ct}")
            source_urls.append(url)

    # Re-extract stale links sequentially (to respect Render memory budget).
    # Hard timeout per link so a slow Whisper/Vision download can't wedge the
    # whole build. Beyond the budget we use whatever content_text was already
    # on the link (caption-only is still useful for the classifier).
    # Budget now tight: 25s total, 20s per link. In production most links
    # have cached content — re-extraction only fires for first-build.
    import time as _time
    REEXTRACT_BUDGET_S = 20.0  # per link
    TOTAL_REEXTRACT_BUDGET_S = 25.0  # across all stale links
    reextract_start = _time.time()
    for link in stale_links:
        url = link.get("url", "")
        budget_left = TOTAL_REEXTRACT_BUDGET_S - (_time.time() - reextract_start)
        if budget_left <= 5:
            logger.warning(
                "[build] Re-extract budget exhausted; skipping %s (using stored content)",
                url,
            )
            fresh = (link.get("extracted_data") or {}).get("content_text", "") or ""
            if fresh:
                content_parts.append(f"--- Source: {url} ---\n{fresh}")
                source_urls.append(url)
            continue
        per_link_timeout = min(REEXTRACT_BUDGET_S, budget_left)
        logger.info(
            "[build] Re-extracting stale link (%.0fs budget): %s",
            per_link_timeout, url,
        )
        try:
            fresh = await asyncio.wait_for(
                _extract_content(url, deep=True),
                timeout=per_link_timeout,
            )
        except asyncio.TimeoutError:
            logger.warning("[build] Re-extract TIMED OUT for %s (%.0fs)", url, per_link_timeout)
            fresh = ""
        except Exception as e:
            logger.warning("[build] Re-extract failed for %s: %s", url, e)
            fresh = ""
        if not fresh:
            # Fall back to whatever was stored, if anything
            fresh = (link.get("extracted_data") or {}).get("content_text", "")
            if not fresh:
                continue
        content_parts.append(f"--- Source: {url} ---\n{fresh}")
        source_urls.append(url)
        # Persist the fresh content so the next build skips re-extraction
        try:
            existing_data = link.get("extracted_data") or {}
            existing_data["content_text"] = fresh[:12000]
            await rails.update_link(
                trip_id, link["id"], extracted_data=existing_data
            )
        except Exception as e:
            logger.warning("[build] Failed to persist fresh content for link %d: %s", link.get("id"), e)

    combined_content = "\n\n".join(content_parts) if content_parts else ""

    if not combined_content:
        return {"error": "No content available", "places_created": 0}

    _mark(
        f"content ready ({len(content_parts)} sources, "
        f"{len(combined_content)} chars, {len(day_plans)} days)"
    )

    # Phase 3 — classify each source URL with its own content so downstream
    # functions can tell "this came from a D-category structured video → lock
    # its days" from "this was a loose B list → scatter freely". The result
    # lives on trip.traveler_profile["content_classification"] for the rest
    # of the build pipeline to read (see _build_itinerary_eco).
    _mark("classifying sources (Haiku per URL, parallel)")
    try:
        import anthropic as _anthropic
        cls_client = _anthropic.Anthropic(api_key=settings.anthropic_api_key)
        per_url_map: dict[str, str] = {}
        for part, url in zip(content_parts, source_urls):
            # `part` is "--- Source: URL ---\n{content}" — strip the header so
            # the classifier sees just the content.
            body = part.split("\n", 1)[1] if "\n" in part else part
            per_url_map[url] = body

        classify_tasks = [
            _classify_and_extract(cls_client, u, c) for u, c in per_url_map.items()
        ]
        cls_results = await asyncio.gather(*classify_tasks, return_exceptions=True)
        classified_rows: list[dict] = []
        for url, res in zip(per_url_map.keys(), cls_results):
            if isinstance(res, dict):
                row = dict(res)
                row["source_url"] = url
                classified_rows.append(row)
        if classified_rows:
            consolidated = _resolve_multi_video_conflicts(classified_rows)
            profile["content_classification"] = consolidated
            trip["traveler_profile"] = profile
            logger.info(
                "[build] Classification ready: canonical_days=%d loose=%d tips=%d",
                len(consolidated.get("canonical_days") or {}),
                len(consolidated.get("loose_places") or []),
                len(consolidated.get("complementary_tips") or []),
            )
    except Exception as e:
        logger.warning("[build] Classifier step failed (continuing without): %s", e)

    ai_mode = trip.get("ai_mode", "eco")

    _mark(f"generating itinerary (mode={ai_mode})")
    if ai_mode == "pro":
        # Pro mode: agentic loop with tools (validate_places, create_batch_items)
        result = await _build_itinerary_pro(
            trip, day_plans, existing_items, combined_content, source_urls,
            rails, places, cost, trip_id,
        )
    else:
        # Eco mode: ONE structured Sonnet call
        result = await _build_itinerary_eco(
            trip, day_plans, existing_items, combined_content, source_urls,
            links, rails, places, cost, trip_id,
        )

    if "error" in result and result.get("places_created", 0) == 0:
        # Log failure but do NOT overwrite extracted_data (preserves content_text for retries)
        logger.error("[build] Itinerary generation failed for trip %d: %s", trip_id, result["error"])
        return result

    _mark("marking links as processed (parallel)")
    # Mark all extracted/processing links as processed (preserve content_text!)
    async def _mark_link_processed(link: dict):
        link_status = link.get("status", "")
        if link_status not in ("extracted", "processing"):
            return
        try:
            existing_data = link.get("extracted_data") or {}
            merged_data = {**existing_data, **result}
            await rails.update_link(trip_id, link["id"], status="processed",
                                    extracted_data=merged_data)
        except Exception as e:
            logger.warning("Failed to mark link %d as processed: %s", link["id"], e)

    await asyncio.gather(*[_mark_link_processed(link) for link in links])

    _mark(f"DONE — {result['places_created']} places, ~${cost.total_cost:.4f}")
    return result


# ──────────────────────────────────────────────
# RESUME: Called after user confirms profile
# (now triggers unified itinerary build for whole trip)
# ──────────────────────────────────────────────


async def resume_processing(
    link_id: int, trip_id: int, http_client=None,
) -> dict:
    """Phase 2 entry point — called after user confirms profile.

    Now builds ONE unified itinerary for the entire trip, not per-link.
    link_id is kept for API compatibility but the build is trip-wide.
    """
    return await build_trip_itinerary(trip_id, http_client)


# ──────────────────────────────────────────────
# PHASE 2 — ECO: Structured Sonnet output
# ──────────────────────────────────────────────


async def _verify_and_optimize_itinerary(
    place_list: list[dict],
    trip: dict,
    day_plans: list[dict],
    cost: CostTracker,
    day_rigidity: dict[int, str] | None = None,
) -> list[dict]:
    """Post-generation verification: optimize timing, grouping, and pacing via Haiku.

    Phase 3: when `day_rigidity` is supplied, locked days are listed in the
    prompt with "do not modify — only fill empty meal slots" semantics.
    After the call, any attempt to reorder or remove items on locked days
    is undone programmatically (defensive safety net).
    """
    if not place_list:
        return place_list

    from app.ai.prompts import build_verification_prompt

    destination = trip.get("destination", "")
    profile = trip.get("traveler_profile") or {}
    day_rigidity = day_rigidity or {}

    # Snapshot the items on locked days so we can restore them if the
    # verification call tried to touch them.
    locked_days = {d for d, r in day_rigidity.items() if r == "locked"}
    locked_snapshot: dict[int, list[dict]] = {}
    if locked_days:
        for p in place_list:
            d = p.get("day")
            if isinstance(d, int) and d in locked_days:
                locked_snapshot.setdefault(d, []).append(p)

    prompt = build_verification_prompt(
        place_list, destination, day_plans, profile, day_rigidity=day_rigidity,
    )

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    try:
        # Verify is a post-generation pass — if it takes > 45s something is
        # wrong. Skipping it is safe (the pre-verify list is already good).
        response = await asyncio.wait_for(
            asyncio.to_thread(
                lambda: client.messages.create(
                    model="claude-haiku-4-5-20251001",
                    max_tokens=16000,
                    messages=[{"role": "user", "content": prompt}],
                    timeout=45.0,
                )
            ),
            timeout=50.0,
        )
        cost.record_usage(response.usage)
        raw = response.content[0].text if response.content else "[]"
    except asyncio.TimeoutError:
        logger.warning("[verify] Verification TIMED OUT, using pre-verify list")
        return place_list
    except Exception as e:
        logger.warning("[verify] Verification call failed, using original: %s", e)
        return place_list

    parsed = _parse_json_response(raw)
    if isinstance(parsed, list) and len(parsed) >= len(place_list) * 0.8 and len(parsed) <= len(place_list) + 8:
        logger.info("[verify] Verification optimized %d → %d items", len(place_list), len(parsed))
        # Defensive: restore locked-day items verbatim if verify tried to touch them.
        if locked_snapshot:
            parsed = _restore_locked_days(parsed, locked_snapshot)
        return parsed

    logger.warning("[verify] Verification returned invalid result (%s items vs %d original), using original",
                   len(parsed) if isinstance(parsed, list) else "non-list", len(place_list))
    return place_list


def _restore_locked_days(
    candidate: list[dict], locked_snapshot: dict[int, list[dict]],
) -> list[dict]:
    """Replace any items on locked days with the pre-verify snapshot. Used
    as a defensive safety net — the prompt already tells Claude not to
    touch locked days, but we enforce it programmatically too."""
    if not candidate or not locked_snapshot:
        return candidate
    result = [p for p in candidate if p.get("day") not in locked_snapshot]
    for day, items in locked_snapshot.items():
        # Append in original order.
        result.extend(items)
    logger.info(
        "[verify] Restored %d locked-day items from snapshot (defensive guard)",
        sum(len(v) for v in locked_snapshot.values()),
    )
    return result


async def _build_day_trip(
    base_city: str,
    destination_city: str,
    target_day: int,
    mentioned_duration_hours: int | None,
    pattern_signature: dict | None,
    cost: CostTracker,
) -> list[dict]:
    """Phase 3.6 — build a FULL day in a secondary (day-trip) city.

    When the classifier flagged a day as `is_day_trip` (e.g. "Tigre from BA"),
    this helper asks Haiku for 3-4 coherent stops WITHIN the secondary city
    so the traveler has a complete day there, not just "go to Tigre" as a
    one-liner.

    Returns a list of item dicts ready to be validated + created. Each item
    has day=target_day, source="ai". If the call fails, returns an empty
    list and the caller keeps whatever was there before.
    """
    if not destination_city:
        return []

    dur_hint = ""
    if isinstance(mentioned_duration_hours, (int, float)) and mentioned_duration_hours > 0:
        dur_hint = f"The creator mentioned ~{int(mentioned_duration_hours)}h for this trip."

    sig_hint = ""
    if pattern_signature:
        sig_hint = (
            f"Match the traveler's rhythm (from their locked days): "
            f"density={pattern_signature.get('density')}, "
            f"item_count~={pattern_signature.get('item_count')}, "
            f"categories={pattern_signature.get('category_mix')}."
        )

    prompt = f"""You are planning Day {target_day} of a trip whose base city is
{base_city}. Day {target_day} is a DAY TRIP to {destination_city}.

Build a COMPLETE day inside {destination_city} — not just a single stop
called "{destination_city}". A traveler spends 6-9 hours there including
transport. Include:
- 1 arrival / opening activity (iconic landmark of {destination_city})
- 1 lunch place in {destination_city}
- 1-2 secondary attractions (neighborhoods, markets, viewpoints)
- 1 evening touch (sunset, a farewell drink) if time permits
- Round-trip transport back to {base_city} at day's end is implicit

{dur_hint}
{sig_hint}

Return ONLY a JSON array of 3-4 items:
[{{"day": {target_day}, "name": "Exact Place Name", "category": "attraction|restaurant|cafe|activity|other", "time_slot": "10:30", "duration_minutes": 120, "description": "Why this is part of the {destination_city} day (in Brazilian Portuguese, with accents).", "notes": "Practical tip (pt-BR).", "vibe_tags": ["cultural", "ao_ar_livre"], "alerts": [], "source": "ai"}}]

RULES:
- All items MUST be in {destination_city}, not in {base_city} or other cities.
- Write description + notes in PERFECT pt-BR with accents.
- Return ONLY the JSON array."""

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    try:
        response = await asyncio.to_thread(
            lambda: client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=3000,
                messages=[{"role": "user", "content": prompt}],
            )
        )
        cost.record_usage(response.usage)
        raw = response.content[0].text if response.content else "[]"
    except Exception as e:
        logger.warning("[day-trip] Build failed for %s: %s", destination_city, e)
        return []

    parsed = _parse_json_response(raw)
    if not isinstance(parsed, list):
        logger.warning("[day-trip] Non-list response for %s, skipping", destination_city)
        return []

    valid: list[dict] = []
    for item in parsed[:4]:
        if not isinstance(item, dict) or not item.get("name"):
            continue
        item["day"] = target_day
        item["source"] = "ai"
        valid.append(item)
    logger.info(
        "[day-trip] Built %d items for Day %d (%s → %s)",
        len(valid), target_day, base_city, destination_city,
    )
    return valid


def _compute_day_signature(day_items: list[dict]) -> dict:
    """Phase 3.5 — distill a day's "flavor" so flexible days can replicate it.

    Given the items of a locked/partially_flexible day (from the video),
    produce a compact descriptor the Sonnet prompt can use as a template:

      {
        "item_count": 4,
        "category_mix": {"attraction": 2, "cafe": 1, "restaurant": 1},
        "avg_duration_min": 105,
        "density": "leve" | "moderado" | "acelerado",
        "tipo_experiencia": ["urbano", "bairro_local"]  # from vibe_tags union
      }

    The prompt shows this to Claude so generated FLEXIBLE days match the
    rhythm the traveler actually wants (not a generic 4.5-item template).
    """
    if not day_items:
        return {}

    from collections import Counter
    cat_counter: Counter[str] = Counter()
    durations: list[int] = []
    vibes: set[str] = set()
    for it in day_items:
        cat = it.get("category")
        if cat:
            cat_counter[cat] += 1
        dur = it.get("duration_minutes")
        if isinstance(dur, (int, float)) and dur > 0:
            durations.append(int(dur))
        for v in (it.get("vibe_tags") or []):
            if isinstance(v, str):
                vibes.add(v)

    item_count = len(day_items)
    avg_duration = int(sum(durations) / len(durations)) if durations else 0

    # Density heuristic: the more items + the longer each, the denser.
    if item_count <= 2:
        density = "leve"
    elif item_count >= 5 or (item_count >= 4 and avg_duration >= 120):
        density = "acelerado"
    else:
        density = "moderado"

    return {
        "item_count": item_count,
        "category_mix": dict(cat_counter),
        "avg_duration_min": avg_duration,
        "density": density,
        "tipo_experiencia": sorted(vibes),
    }


# ──────────────────────────────────────────────
# OUTPUT VALIDATION + REPAIR LAYER (spec STEPs 6, 7, 8, 9)
# ──────────────────────────────────────────────


def _normalize_for_compare(s: str) -> str:
    """Lowercase + strip accents for name/destination comparisons."""
    if not s:
        return ""
    import unicodedata
    return "".join(
        c for c in unicodedata.normalize("NFD", s.lower())
        if unicodedata.category(c) != "Mn"
    ).strip()


def _is_destination_as_activity(
    item_name: str,
    destination: str,
    cities: list[str],
    country: str,
) -> bool:
    """Return True if this item's name is just a bare destination (city,
    country, region) with no activity context. These never survive the
    validator — they're structurally useless cards like 'Day 2: Paris'.

    Heuristic: normalized name is an exact match (or prefix before a comma)
    of the trip's destination, a detected city, or the country.
    """
    nname = _normalize_for_compare(item_name)
    if not nname or len(nname) < 3:
        return False
    candidates: list[str] = []
    if destination:
        candidates.append(_normalize_for_compare(destination))
        # Destinations often come as "City, Country" — split and compare.
        if "," in destination:
            for part in destination.split(","):
                candidates.append(_normalize_for_compare(part))
    if country:
        candidates.append(_normalize_for_compare(country))
    for city in cities or []:
        candidates.append(_normalize_for_compare(city))
    return any(nname == c for c in candidates if c)


# Generic category names that destroy the itinerary when used as item
# names. The user's #1 complaint: Sonnet emits "city exploration" with
# the real places buried in the notes as "Onde fazer: X, Y". We detect
# these and drop them so thin-day repair can replace with specific
# venues. Plain lowercase keys; comparison is done on _normalize_for_compare.
_GENERIC_CATEGORY_NAMES = {
    # Bars / rooftops
    "rooftop", "rooftop bar", "rooftop bars", "rooftops", "bars", "bar",
    # City exploration
    "city exploration", "explorar a cidade", "exploracao da cidade",
    "explore the city", "passeio pela cidade",
    # Beach relaxation
    "relaxar na praia", "relax na praia", "beach day", "beach relaxation",
    "praia", "praias", "beach", "descansar", "descanso", "chill",
    "beach exploration", "blue sea", "crystal clear sea", "clear sea",
    "calm and tranquil island", "maldives-like scenery",
    # Food / markets generic
    "food tour", "street food", "comida de rua", "mercados", "mercados locais",
    "comida local", "food experience", "upscale restaurant", "fine dining",
    "restaurants", "restaurant",
    # Cultural generic
    "cultural immersion", "imersao cultural", "cultura local",
    "templos", "templos budistas", "temples", "temple",
    "thai culture", "thai culture and religion", "culture", "religion",
    "cultural experience", "festival of lanterns", "festival",
    # Nightlife generic
    "vida noturna", "nightlife", "night out", "festa",
    # Shopping generic
    "shopping", "compras", "mercado", "market",
    "hotels", "luxury hotels", "luxury hotel", "accommodation",
    # Generic activities
    "passeio", "passeios", "tour", "tours", "atividade", "atividades",
    "city tour", "walking tour",  # unless named (e.g. "Free Walking Tour Rome")
    "island hopping", "ilhas", "islands", "island",
    "famous cave", "cave", "caverna",
    "boat transfer", "boat transfer (4 hours)", "ferry transfer",
    "early morning visit",
}

# Generic adjective/noun tokens — if EVERY meaningful token in the item
# name is in this set, the name is structural filler, not a venue.
_GENERIC_TOKENS = {
    "calm", "tranquil", "luxury", "upscale", "crystal", "clear",
    "blue", "famous", "historic", "beautiful", "amazing", "iconic",
    "traditional", "local", "thai", "asian", "tropical",
    "hotels", "hotel", "restaurant", "restaurants", "cafe", "bar", "bars",
    "temples", "temple", "beach", "beaches", "island", "islands",
    "cave", "caves", "market", "markets", "street", "food",
    "tour", "tours", "passeio", "relaxation", "exploration",
    "visit", "experience", "scenery",
    "and", "or", "the", "a", "an", "of", "with", "in",
    "com", "de", "da", "do", "das", "dos", "o", "a", "e", "ou",
}


def _is_generic_category_name(item_name: str) -> bool:
    """True if the item's name is a bare category ("rooftop bars",
    "city exploration", "luxury hotels", "blue sea") rather than a
    specific venue. These items destroy the itinerary by burying real
    places in their notes field.

    Detection uses TWO signals:
      1. Exact match against _GENERIC_CATEGORY_NAMES (hand-curated list).
      2. Structural check: after stripping parenthetical notes, every
         meaningful token is in _GENERIC_TOKENS (common adjectives and
         plural common nouns). A real venue name always has at least
         one proper-noun token Google/humans would capitalize.
    """
    nname = _normalize_for_compare(item_name)
    if not nname:
        return False
    # Strip parenthetical notes like "(end of year)" or "(4 hours)".
    import re as _re
    stripped = _re.sub(r"\s*\([^)]*\)\s*", " ", nname).strip()
    # Exact match — the most reliable signal.
    if stripped in _GENERIC_CATEGORY_NAMES or nname in _GENERIC_CATEGORY_NAMES:
        return True
    # "Onde fazer em X" / "O que fazer" style → still generic.
    if stripped.startswith("onde fazer") or stripped.startswith("o que fazer"):
        return True
    # "Chegada" / "Arrival" with nothing else is generic.
    if stripped in {"chegada", "arrival", "partida", "departure", "volta", "voo"}:
        return True
    # Structural: every meaningful token is common/generic. Strips short
    # tokens (<3 chars) which are usually articles/conjunctions.
    tokens = [t for t in stripped.split() if len(t) >= 3]
    if len(tokens) >= 1:
        non_generic = [t for t in tokens if t not in _GENERIC_TOKENS]
        if not non_generic:
            return True
        # Length 1-2 AND at least one token is generic → likely generic.
        if len(tokens) <= 2 and any(t in _GENERIC_TOKENS for t in tokens) and all(
            t in _GENERIC_TOKENS or t in _GENERIC_CATEGORY_NAMES for t in tokens
        ):
            return True
    return False


def _validate_and_repair_itinerary(
    place_list: list[dict],
    trip: dict,
    day_plans: list[dict],
    day_rigidity: dict[int, str] | None = None,
) -> tuple[list[dict], dict]:
    """Final programmatic pass that enforces the spec's output rules:

      STEP 6 — Day completeness: a day must have ≥2 items OR exactly one
               full-day item (duration ≥ 360 min) OR be a pure transfer day.
      STEP 7 — Destination ≠ activity: never keep an item whose name is
               just a bare city/country/region.
      STEP 8 — Multi-base transport: in multi-base trips, the day between
               two different base cities MUST carry a `transfer` item.
      STEP 9 — Validation report: surface every violation the validator
               couldn't auto-fix so the UI can show a "heads up" banner.

    Auto-fixes applied:
      - destination-as-activity items are DROPPED
      - thin days are MARKED incomplete (completable in a later refine pass)
      - missing transfer days get a synthesized transfer item injected so
        the traveler isn't left guessing about cross-base travel

    Returns `(repaired_place_list, validation_report)`. The report is
    persisted on traveler_profile.validation_report so the frontend can
    surface issues (empty-day banner, "we couldn't fill Day 3", etc.)
    """
    day_rigidity = day_rigidity or {}
    profile = trip.get("traveler_profile") or {}
    destination = (trip.get("destination") or "").strip()
    cities = profile.get("cities_detected") or []
    country = (profile.get("country_detected") or "").strip()

    report: dict = {
        "dropped_destination_as_activity": [],
        "dropped_generic_category": [],  # NEW — "rooftop bars", "city exploration"
        "thin_days": [],
        "injected_transfers": [],
        "total_violations": 0,
    }

    # ── STEP 7: strip destination-as-activity items ────────────────────
    filtered: list[dict] = []
    for p in place_list:
        name = (p.get("name") or "").strip()
        if _is_destination_as_activity(name, destination, cities, country):
            report["dropped_destination_as_activity"].append({
                "name": name,
                "day": p.get("day"),
            })
            logger.warning(
                "[validate] Dropping '%s' on day %s — bare destination, not an activity",
                name, p.get("day"),
            )
            continue
        # NEW — reject generic category names ("rooftop bars",
        # "city exploration", "relaxar na praia"). These are the items
        # where Sonnet buries real places in the notes field. We drop
        # them so thin-day repair fires with specific venues instead.
        if _is_generic_category_name(name):
            report["dropped_generic_category"].append({
                "name": name,
                "day": p.get("day"),
                "notes_preview": (p.get("notes") or "")[:120],
            })
            logger.warning(
                "[validate] Dropping '%s' on day %s — generic category, "
                "not a specific venue",
                name, p.get("day"),
            )
            continue
        filtered.append(p)

    place_list = filtered

    # Index by day for the remaining checks.
    by_day: dict[int, list[dict]] = {}
    for p in place_list:
        d = p.get("day")
        if isinstance(d, int):
            by_day.setdefault(d, []).append(p)

    num_days = len(day_plans)
    day_plan_by_number = {dp.get("day_number"): dp for dp in day_plans}

    # ── STEP 8: multi-base transport — DISABLED ──────────────────────
    # Previously this block injected a "Transfer: City A → City B" card
    # as an itinerary_item (category=transport) on every day where the
    # city changed. The cards polluted the day cards, pushed real items
    # down, and added nothing the user didn't already know from seeing
    # the city change between days. Removed per user feedback. The
    # transition info lives implicitly in day_plan.city.

    # ── STEP 6: day completeness ──────────────────────────────────────
    # Track names per day for the post-pass repeated-generic detection.
    day_item_names: dict[int, list[str]] = {
        d: [(it.get("name") or "") for it in by_day.get(d, [])]
        for d in range(1, num_days + 1)
    }

    for d in range(1, num_days + 1):
        day_items = by_day.get(d, [])
        if len(day_items) >= 2:
            continue
        # Single-item days are OK if it's a genuine full-day activity
        # AND the name isn't generic ("relaxar na praia" × 600min still
        # sucks — it's a placeholder, not a plan).
        if len(day_items) == 1:
            solo = day_items[0]
            dur = solo.get("duration_minutes") or 0
            amodel = solo.get("activity_model") or ""
            solo_name = solo.get("name") or ""
            if (dur >= 360 or amodel in ("guided_excursion", "day_trip", "transfer")) \
               and not _is_generic_category_name(solo_name):
                continue
        # Locked days are treated as-is — user/video said so.
        if day_rigidity.get(d) == "locked":
            continue
        report["thin_days"].append({
            "day": d,
            "item_count": len(day_items),
            "reason": "empty" if len(day_items) == 0 else "short_or_generic",
        })
        logger.warning(
            "[validate] Day %d is thin — %d item(s), no full-day activity",
            d, len(day_items),
        )

    # NEW — detect runs of days with repeated / near-identical items
    # (e.g., "relaxar na praia" on days 12, 13, 14). Even if each day has
    # ≥2 items, if the names are all generic AND repeat, the day needs
    # to be broken up into specific activities.
    seen_repeat: set[int] = set()
    for d in range(1, num_days - 1):
        names_d   = [n for n in day_item_names.get(d, [])     if n]
        names_d1  = [n for n in day_item_names.get(d + 1, []) if n]
        if not names_d or not names_d1:
            continue
        if d in seen_repeat:
            continue
        # If EVERY name on consecutive days is generic → flag both.
        all_generic_d  = all(_is_generic_category_name(n) for n in names_d)
        all_generic_d1 = all(_is_generic_category_name(n) for n in names_d1)
        if all_generic_d and all_generic_d1:
            for td in (d, d + 1):
                if td in seen_repeat:
                    continue
                seen_repeat.add(td)
                # Only add if not already flagged above.
                if not any(t.get("day") == td for t in report["thin_days"]):
                    report["thin_days"].append({
                        "day": td,
                        "item_count": len(day_item_names.get(td, [])),
                        "reason": "generic_run",
                    })
                    logger.warning(
                        "[validate] Day %d flagged — generic-only names "
                        "repeat across consecutive days", td,
                    )

    # Rollup
    report["total_violations"] = (
        len(report["dropped_destination_as_activity"])
        + len(report.get("dropped_generic_category", []))
        + len(report["thin_days"])
        + len(report["injected_transfers"])
    )
    if report["total_violations"]:
        logger.info(
            "[validate] Validation pass — dropped=%d thin=%d transfers=%d",
            len(report["dropped_destination_as_activity"]),
            len(report["thin_days"]),
            len(report["injected_transfers"]),
        )
    else:
        logger.info("[validate] All validation rules passed cleanly")

    return place_list, report


# ──────────────────────────────────────────────
# STEP 2.9 — Fill empty days after geo + dedup cleanup
# ──────────────────────────────────────────────

async def _fill_empty_days_after_cleanup(
    validated: list[dict],
    day_plans: list[dict],
    trip: dict,
    cost: CostTracker,
    places: GooglePlacesClient,
) -> list[dict]:
    """Detect days that ended up empty AFTER geo-cluster tightening +
    final dedup + day-trip isolation, and fill them with a structured
    Sonnet suggestion (preferring a day-trip when the destination is
    well-known for one — Tigre for BsAs, Versailles for Paris, Sintra
    for Lisbon, etc.). Each suggestion is enriched with a Google Places
    lookup so the items have real lat/lng/place_id before reaching Rails.

    Empty here means 0 items — we don't touch days with even 1 item
    (those get a thin-days banner via the regular validator). Locked
    days are skipped.

    Fail-open: if the Sonnet call or Google Places lookup fails, we
    return the validated list unchanged. The user sees an empty day
    with a banner rather than the build aborting.
    """
    by_day: dict[int, list[dict]] = {}
    for item in validated:
        d = item.get("day")
        if isinstance(d, int):
            by_day.setdefault(d, []).append(item)

    locked_days = {
        dp.get("day_number") for dp in day_plans
        if (dp.get("rigidity") or "").lower() == "locked"
    }
    empty_days = [
        dp.get("day_number") for dp in day_plans
        if dp.get("day_number")
        and dp.get("day_number") not in locked_days
        and not by_day.get(dp.get("day_number"))
    ]
    if not empty_days:
        return validated

    profile = trip.get("traveler_profile") or {}
    destination = trip.get("destination") or ""
    country = profile.get("country_detected") or ""
    cities = profile.get("cities_detected") or []
    base_city = cities[0] if cities else (destination.split(",")[0].strip() if destination else "")
    interests = ", ".join((profile.get("interests") or [])[:5])

    # Names already in the itinerary — Sonnet must NOT duplicate them.
    existing_names = sorted({
        (it.get("name") or "").strip() for it in validated if it.get("name")
    })

    logger.warning(
        "[empty-day-fill] %d empty day(s) after cleanup: %s — calling Sonnet",
        len(empty_days), empty_days,
    )

    prompt = f"""You are filling EMPTY days in a travel itinerary. The build pipeline ran and these specific days came out with zero activities. You must propose a coherent, structured day for each — NOT a random list.

Trip context:
  Destination: {destination}
  Country: {country}
  Base city: {base_city}
  Traveler interests: {interests}

Empty days to fill: {empty_days}

Already-scheduled places (DO NOT duplicate ANY of these):
{chr(10).join(f"  - {n}" for n in existing_names[:40])}

Rules for each empty day:
1. Pick ONE coherent theme. Either:
   (a) A structured DAY-TRIP from {base_city or 'the base city'} — e.g. Tigre Delta + Puerto de Frutos for BsAs, Versailles full day for Paris, Sintra+Cabo da Roca for Lisbon. The day-trip destination becomes 1 main item with duration_minutes>=300 and item_role="day_trip_destination". Include 1-2 anchored experiences IN that destination city (lunch, viewpoint, attraction).
   (b) A NEIGHBORHOOD-themed day in {base_city} — pick a real bairro NOT already heavily used (look at the existing list above). 4-5 items in walking distance: 2-3 attractions + 1 restaurant + 1 cafe/viewpoint.
2. Geographic coherence is non-negotiable: every item is either at the same destination (option a) or in the same neighborhood (option b).
3. NEVER duplicate any name from the "Already-scheduled" list above.
4. Names must be REAL, specific places — never bare neighborhood names like "Palermo" or generic categories like "rooftop bar".

Output ONLY a JSON array. Each item:
{{"day": <day_number>, "name": "Exact Specific Place Name", "category": "restaurant|attraction|activity|cafe|shopping|nightlife|other", "time_slot": "HH:MM", "duration_minutes": <int>, "description": "1 short sentence in pt-BR with proper accents — what makes this place worth it.", "notes": "Practical tip in pt-BR.", "vibe_tags": ["tag"], "activity_model": "direct_place|day_trip|anchored_experience|guided_excursion", "visit_mode": "self_guided|guided|book_separately", "item_role": "attraction|day_trip_destination|experience_activity|restaurant", "source": "ai"}}

For each empty day, output 4-5 items. Nothing else."""

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key, max_retries=0)
    try:
        response = await asyncio.wait_for(
            asyncio.to_thread(
                lambda: client.messages.create(
                    model="claude-sonnet-4-20250514",
                    max_tokens=4500,
                    messages=[{"role": "user", "content": prompt}],
                    timeout=50.0,
                )
            ),
            timeout=55.0,
        )
        cost.record_usage(response.usage)
        raw = response.content[0].text if response.content else "[]"
    except asyncio.TimeoutError:
        logger.warning("[empty-day-fill] Sonnet timed out — leaving empty days flagged")
        return validated
    except Exception as e:
        logger.warning("[empty-day-fill] Sonnet failed (%s)", e)
        return validated

    parsed = _parse_json_response(raw)
    if not isinstance(parsed, list):
        logger.warning("[empty-day-fill] Parse failed, raw: %s", raw[:200])
        return validated

    # Filter to valid empty-day items + dedup against existing names.
    existing_norms = {_normalize_place_name(n) for n in existing_names if n}
    candidates: list[dict] = []
    for it in parsed:
        if not isinstance(it, dict):
            continue
        d = it.get("day")
        if not isinstance(d, int) or d not in empty_days:
            continue
        name = (it.get("name") or "").strip()
        if not name:
            continue
        if _normalize_place_name(name) in existing_norms:
            continue
        # Defensive defaults.
        it.setdefault("category", "attraction")
        it.setdefault("activity_model", "direct_place")
        it.setdefault("visit_mode", "self_guided")
        it.setdefault("source", "ai")
        candidates.append(it)

    if not candidates:
        logger.warning("[empty-day-fill] Sonnet returned no usable items")
        return validated

    # Google Places enrichment — populate lat/lng/place_id so the items
    # render properly on the map and pass downstream constraints.
    geo_query_city = base_city or destination
    enriched_count = 0
    for cand in candidates:
        try:
            query = f"{cand['name']} {geo_query_city}"
            results = await places.search(query)
            if not results:
                continue
            top = results[0]
            details = await places.get_details(top.get("place_id"))
            if not details:
                continue
            geo = details.get("geometry") or {}
            loc = geo.get("location") or {}
            cand["latitude"] = loc.get("lat")
            cand["longitude"] = loc.get("lng")
            cand["address"] = details.get("formatted_address")
            cand["google_place_id"] = details.get("place_id")
            cand["google_rating"] = details.get("rating")
            cand["google_reviews_count"] = details.get("user_ratings_total")
            cand["operating_hours"] = details.get("opening_hours") or {}
            cand["phone"] = details.get("formatted_phone_number")
            cand["website"] = details.get("website")
            photos = []
            for p in (details.get("photos") or [])[:2]:
                ref = p.get("photo_reference")
                if ref:
                    photos.append(
                        f"https://maps.googleapis.com/maps/api/place/photo?"
                        f"maxwidth=400&photo_reference={ref}&key={settings.google_places_api_key}"
                    )
            cand["photos"] = photos
            enriched_count += 1
        except Exception as e:
            logger.warning("[empty-day-fill] geo lookup failed for '%s': %s", cand.get("name"), e)
            continue

    # Only keep items with coords — Rails accepts items without lat/lng
    # but the map breaks. If a place couldn't be geocoded, drop it.
    final_new = [c for c in candidates if c.get("latitude") and c.get("longitude")]
    logger.info(
        "[empty-day-fill] Sonnet=%d, geocoded=%d, kept=%d (filling %s)",
        len(candidates), enriched_count, len(final_new), empty_days,
    )
    return validated + final_new


# ──────────────────────────────────────────────
# STEP 3 — Auto-refine thin days (targeted Sonnet call)
# ──────────────────────────────────────────────

async def _repair_thin_days(
    thin_days: list[dict],
    place_list: list[dict],
    trip: dict,
    day_plans: list[dict],
    cost: CostTracker,
) -> list[dict]:
    """When the validator flagged thin days (<2 items, no full-day item),
    fire ONE focused Sonnet call asking for 2-3 activities per thin day.
    Respects the day's base city, the trip's destination_type, and the
    items already present on neighboring days (for geographic flow).

    Returns an updated place_list with the injected items appended. If
    the call fails/times out, returns the original list unchanged — the
    thin-day banner in the UI still surfaces the issue so the user can
    refine via chat.
    """
    if not thin_days:
        return place_list

    profile = trip.get("traveler_profile") or {}
    destination = trip.get("destination") or ""
    country = profile.get("country_detected") or ""
    cities = profile.get("cities_detected") or []
    dest_classification = profile.get("destination_classification") or {}
    dest_type = dest_classification.get("destination_type") or "walkable_urban"
    travel_style = profile.get("travel_style") or ""
    interests = ", ".join(profile.get("interests") or [])

    # Build a quick summary of existing items by day (keeps the prompt small).
    items_by_day: dict[int, list[str]] = {}
    for p in place_list:
        d = p.get("day")
        if isinstance(d, int):
            items_by_day.setdefault(d, []).append(p.get("name") or "")
    day_plan_by_num = {dp.get("day_number"): dp for dp in day_plans}

    # Compose a context block per thin day.
    thin_contexts = []
    thin_day_numbers: list[int] = []
    for t in thin_days:
        d = t.get("day")
        if not isinstance(d, int):
            continue
        thin_day_numbers.append(d)
        dp = day_plan_by_num.get(d) or {}
        city = dp.get("city") or cities[0] if cities else ""
        existing = items_by_day.get(d, [])
        neighbors = []
        for nd in (d - 1, d + 1):
            ni = items_by_day.get(nd, [])
            if ni:
                neighbors.append(f"Day {nd}: {', '.join(ni[:3])}")
        thin_contexts.append(
            f"- Day {d} (base: {city or 'unspecified'}). Already has: "
            f"{', '.join(existing) if existing else '(nothing)'}. "
            f"Neighbors — {' · '.join(neighbors) if neighbors else 'no context'}."
        )

    if not thin_day_numbers:
        return place_list

    prompt = f"""You are filling in thin days in a travel itinerary. The main build finished, but these days ended up with too few activities to be usable. Add 2-3 coherent activities per listed day.

Trip context:
  Destination: {destination}
  Country: {country}
  Destination type: {dest_type}
  Traveler style: {travel_style}
  Interests: {interests}

Thin days to repair:
{chr(10).join(thin_contexts)}

Rules:
- Each new item must be a REAL place or concrete activity — never a bare city/country name.
- Respect the day's base city. Do not pull items from a different city.
- Items on the same day must be geographically coherent (walkable or within 20 min).
- If the day is in a tour_driven or multi_base destination, prefer one full-day excursion over four short items.
- Use the traveler's interests. If the profile says "museums", include museums; if "nature", include parks/hikes.
- Do NOT duplicate items already on that day or on neighboring days.

Return ONLY a JSON array. Each object:
{{"day": <day number>, "name": "Exact Place Name", "category": "restaurant|attraction|activity|cafe|shopping|nightlife|other", "time_slot": "HH:MM", "duration_minutes": <minutes>, "description": "One short sentence in Brazilian Portuguese (pt-BR) with proper accents — why this is worth it.", "notes": "Practical tip in pt-BR.", "vibe_tags": ["tag1"], "activity_model": "direct_place|anchored_experience|guided_excursion|day_trip", "visit_mode": "self_guided|guided|book_separately|operator_based", "source": "ai"}}

Output 2-3 items per thin day. Nothing else."""

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key, max_retries=0)

    try:
        response = await asyncio.wait_for(
            asyncio.to_thread(
                lambda: client.messages.create(
                    model="claude-sonnet-4-20250514",
                    max_tokens=4000,
                    messages=[{"role": "user", "content": prompt}],
                    timeout=45.0,
                )
            ),
            timeout=50.0,
        )
        cost.record_usage(response.usage)
        raw = response.content[0].text if response.content else "[]"
    except asyncio.TimeoutError:
        logger.warning("[thin-repair] Timed out — leaving thin days flagged")
        return place_list
    except Exception as e:
        logger.warning("[thin-repair] Call failed (%s) — leaving thin days flagged", e)
        return place_list

    parsed = _parse_json_response(raw)
    if not isinstance(parsed, list):
        logger.warning("[thin-repair] Parse failed, raw: %s", raw[:200])
        return place_list

    # Sanity-filter: only keep items whose day matches a thin day.
    added = 0
    for item in parsed:
        if not isinstance(item, dict):
            continue
        d = item.get("day")
        if not isinstance(d, int) or d not in thin_day_numbers:
            continue
        # Default activity_model/visit_mode if missing.
        item.setdefault("activity_model", "direct_place")
        item.setdefault("visit_mode", "self_guided")
        item.setdefault("source", "ai")
        place_list.append(item)
        added += 1

    logger.info(
        "[thin-repair] Sonnet added %d items across %d thin days",
        added, len(thin_day_numbers),
    )
    return place_list


# ──────────────────────────────────────────────
# STEP 4 — External itinerary research (Tavily)
# ──────────────────────────────────────────────

class FlexibleResearchUnavailable(Exception):
    """Raised when mandatory flexible-day research cannot be produced.

    This is a hard failure — per product policy ("nenhum risco de ir sem"),
    a build must NOT proceed without external research when the trip has
    flexible days to fill. Caller should surface this as a visible build
    error so the user can retry, rather than silently producing a thin
    itinerary from internal LLM knowledge alone.
    """
    pass


async def _research_flexible_day_places(
    country: str,
    cities: list[str],
    num_days: int,
    interests: list[str],
    places_mentioned: list[dict],
    flex_days_count: int,
    http_client=None,
) -> str:
    """Query Tavily for real places to fill FLEXIBLE days — the ones the
    user's videos didn't already script. Fires any time there are 2+
    flexible days, regardless of destination_type.

    Hard contract: returns a non-empty blob on success. Raises
    FlexibleResearchUnavailable if Tavily is unconfigured or every query
    failed after retries. The caller MUST let that exception propagate
    — do not silently swallow it and continue, or the build degrades
    into a LLM-knowledge-only itinerary which is exactly what this
    function exists to prevent.

    Retry strategy: each query is retried up to 3 times with exponential
    backoff (1s, 2s, 4s) on network errors, timeouts, or HTTP 5xx. A 4xx
    from Tavily (auth, bad query) is NOT retried — fail fast on config
    bugs.

    Returns ≤ 2500 chars on success.
    """
    if flex_days_count < 1 or not cities or not country:
        # Not applicable — 1-day trip or missing geo context. Not a failure.
        return ""

    if not settings.tavily_api_key:
        raise FlexibleResearchUnavailable(
            "TAVILY_API_KEY não configurado — build bloqueado porque política "
            "do produto exige pesquisa externa para preencher dias flexible. "
            "Configure a variável de ambiente TAVILY_API_KEY no serviço."
        )

    import httpx as _httpx

    city = cities[0]
    known_names = [
        (p.get("name") or "").strip()
        for p in (places_mentioned or [])[:5]
        if (p.get("name") or "").strip()
    ]
    besides_clause = f" besides {', '.join(known_names)}" if known_names else ""

    queries = [
        f"top hidden gems and attractions in {city}, {country}{besides_clause}",
        f"best local restaurants and cafes in {city} travel blog",
    ]
    lower_interests = [str(i).lower() for i in (interests or [])]
    def _has(*keys: str) -> bool:
        return any(k in t for t in lower_interests for k in keys)
    thematic = None
    if _has("vida_noturna", "nightlife", "bar"):
        thematic = f"best bars and nightlife in {city}"
    elif _has("gastronom", "food", "restaurant"):
        thematic = f"must-try restaurants and food spots in {city}"
    elif _has("hidden", "hidden_gem", "local"):
        thematic = f"off the beaten path things to do in {city}"
    elif _has("cultural", "museum", "arte"):
        thematic = f"best museums and cultural sites in {city}"
    elif _has("ao_ar_livre", "nature", "outdoor", "parque"):
        thematic = f"best parks and outdoor activities in {city}"
    if thematic:
        queries.append(thematic)

    own_client = http_client is None
    client = http_client or _httpx.AsyncClient(timeout=15.0)
    snippets: list[str] = []
    query_errors: list[str] = []

    async def _run_query(q: str) -> list[str]:
        """Run one query with retries. Returns snippets list (may be
        empty if query succeeded but had no useful content). Raises on
        exhaustion only if every attempt failed with a retryable error.
        """
        last_err: Exception | None = None
        for attempt in range(3):
            try:
                resp = await asyncio.wait_for(
                    client.post(
                        "https://api.tavily.com/search",
                        json={
                            "api_key": settings.tavily_api_key,
                            "query": q,
                            "search_depth": "basic",
                            "include_answer": True,
                            "max_results": 4,
                        },
                        headers={"Content-Type": "application/json"},
                    ),
                    timeout=12.0,
                )
                if 400 <= resp.status_code < 500:
                    raise FlexibleResearchUnavailable(
                        f"Tavily {resp.status_code} on '{q}': {resp.text[:200]} "
                        "(config/auth issue — not retryable)"
                    )
                if resp.status_code != 200:
                    last_err = RuntimeError(
                        f"Tavily {resp.status_code}: {resp.text[:200]}"
                    )
                    await asyncio.sleep(2 ** attempt)
                    continue

                data = resp.json()
                out: list[str] = []
                answer = (data.get("answer") or "").strip()
                if answer:
                    out.append(f"[Q: {q}]\n{answer[:700]}")
                for r in (data.get("results") or [])[:3]:
                    content = (r.get("content") or "").strip()
                    if content:
                        out.append(f"  - {content[:300]}")
                return out
            except FlexibleResearchUnavailable:
                raise
            except (asyncio.TimeoutError, _httpx.HTTPError, _httpx.NetworkError) as e:
                last_err = e
                logger.warning(
                    "[flex-research] retryable error on '%s' (attempt %d): %s",
                    q, attempt + 1, e,
                )
                await asyncio.sleep(2 ** attempt)
            except Exception as e:
                last_err = e
                logger.warning("[flex-research] error on '%s': %s", q, e)
                break
        raise FlexibleResearchUnavailable(
            f"Tavily unreachable after 3 attempts for '{q}': {last_err}"
        )

    try:
        for q in queries:
            try:
                out = await _run_query(q)
                snippets.extend(out)
            except FlexibleResearchUnavailable as e:
                query_errors.append(f"{q}: {e}")
                logger.error("[flex-research] query FAILED: %s", e)
    finally:
        if own_client:
            await client.aclose()

    if not snippets:
        raise FlexibleResearchUnavailable(
            "Nenhuma query Tavily retornou conteúdo após retries. "
            f"Erros: {'; '.join(query_errors) if query_errors else 'respostas vazias'}"
        )

    summary = "\n\n".join(snippets)[:2500]
    logger.info(
        "[flex-research] %d snippets (%d chars) for %s — %d flex days, %d known places",
        len(snippets), len(summary), city, flex_days_count, len(known_names),
    )
    return summary


async def _research_itinerary_patterns(
    country: str,
    cities: list[str],
    num_days: int,
    destination_type: str,
    http_client=None,
) -> str:
    """Query Tavily for real travel guides to learn how this destination
    is commonly structured (STEP 4 of the planning spec). Returns a
    compact summary string (≤ 1500 chars) that gets injected into the
    Sonnet prompt under "COMMON PATTERNS FROM REAL TRAVEL GUIDES".

    Only fires for destinations that benefit from external structure:
    tour_driven and multi_base. Walkable urban cities rarely need it —
    Sonnet already knows Paris/Rome inside out.

    Fails open: if Tavily is unconfigured, times out, or returns junk,
    returns an empty string and the build proceeds without the research
    context.
    """
    if destination_type not in {"tour_driven", "multi_base"}:
        return ""
    if not settings.tavily_api_key:
        logger.info("[research] Tavily not configured — skipping external research")
        return ""
    if not country:
        return ""

    import httpx as _httpx

    # Two focused queries. Tavily returns both snippets and curated answers.
    queries = [
        f"{num_days}-day itinerary {country}",
        f"best day trips and tours in {country}",
    ]
    own_client = http_client is None
    client = http_client or _httpx.AsyncClient(timeout=15.0)

    snippets: list[str] = []
    try:
        for q in queries:
            try:
                resp = await asyncio.wait_for(
                    client.post(
                        "https://api.tavily.com/search",
                        json={
                            "api_key": settings.tavily_api_key,
                            "query": q,
                            "search_depth": "basic",
                            "include_answer": True,
                            "max_results": 3,
                        },
                        headers={"Content-Type": "application/json"},
                    ),
                    timeout=10.0,
                )
                if resp.status_code != 200:
                    logger.warning(
                        "[research] Tavily %d on '%s': %s",
                        resp.status_code, q, resp.text[:200],
                    )
                    continue
                data = resp.json()
                answer = (data.get("answer") or "").strip()
                if answer:
                    snippets.append(f"[Q: {q}]\n{answer[:600]}")
                for r in (data.get("results") or [])[:2]:
                    content = (r.get("content") or "").strip()
                    if content:
                        snippets.append(f"  - {content[:250]}")
            except asyncio.TimeoutError:
                logger.warning("[research] Tavily timeout on '%s'", q)
            except Exception as e:
                logger.warning("[research] Tavily error on '%s': %s", q, e)
    finally:
        if own_client:
            await client.aclose()

    if not snippets:
        return ""

    summary = "\n\n".join(snippets)[:1500]
    logger.info(
        "[research] Gathered %d snippets (%d chars) for %s",
        len(snippets), len(summary), country,
    )
    return summary


# ──────────────────────────────────────────────
# STEP 2 — Semantic item role (computed from existing fields)
# ──────────────────────────────────────────────

ITEM_ROLES = {
    "landmark",           # iconic destination-defining place
    "attraction",         # notable but not necessarily iconic
    "neighborhood",       # a district to walk/explore
    "museum_cultural",    # museum, gallery, cultural space
    "beach_island",       # beach, island, coastal spot
    "viewpoint_nature",   # viewpoint, park, nature spot
    "food_market",        # food market, street food area
    "nightlife_venue",    # bar, club, live music
    "experience_activity",# tango show, cooking class, tour
    "transport_leg",      # transfer day content
    "day_trip_destination", # the destination of a day trip
}


def _compute_item_role(item: dict) -> str | None:
    """Derive a semantic role from existing fields (activity_model,
    category, vibe_tags, name). Runs cost-free and keeps STEP 2's spec
    intent (every item is semantically classified before use) without
    requiring a Sonnet-emitted field or DB migration.

    Returns one of ITEM_ROLES, or None if the signal is too weak to
    commit to a role.
    """
    amodel = item.get("activity_model")
    category = (item.get("category") or "").lower()
    vibes = set((item.get("vibe_tags") or []))
    name = (item.get("name") or "").lower()

    # activity_model gives us strong signals first.
    if amodel == "transfer":
        return "transport_leg"
    if amodel == "day_trip":
        return "day_trip_destination"
    if amodel in ("guided_excursion", "route_cluster"):
        return "experience_activity"
    if amodel == "anchored_experience":
        return "experience_activity"

    # Vibe-tag signals override noisy category.
    if "experiencia" in vibes or "cultural" in vibes and category == "activity":
        return "experience_activity"
    if "vista_panoramica" in vibes:
        return "viewpoint_nature"
    if "ao_ar_livre" in vibes and category != "restaurant":
        return "viewpoint_nature"

    # Category fallback.
    if category == "nightlife":
        return "nightlife_venue"
    if category in {"restaurant", "cafe"}:
        # Treat food markets (have "mercado" or "market" in name) specially.
        if "mercado" in name or "market" in name or "feira" in name:
            return "food_market"
        return None  # ordinary restaurant/cafe — no special role
    if category == "shopping":
        if "mercado" in name or "market" in name:
            return "food_market"
        return "attraction"
    if category == "attraction":
        # Heuristic: museums/galleries/temples
        for hint in ("museu", "museum", "galeria", "gallery", "templo", "temple", "church", "igreja", "catedral", "cathedral"):
            if hint in name:
                return "museum_cultural"
        # Beaches/islands
        for hint in ("praia", "beach", "island", "ilha"):
            if hint in name:
                return "beach_island"
        # Viewpoints/parks
        for hint in ("mirante", "viewpoint", "parque", "park", "jardim", "garden", "observatory", "observatório"):
            if hint in name:
                return "viewpoint_nature"
        return "attraction"
    if category == "activity":
        return "experience_activity"
    return None


def _is_generic_region(name: str) -> bool:
    """Return True when the string looks like a regional label ("Northern
    Thailand", "Tailândia do Norte", "Highlands", etc.) rather than a
    specific city. Used as a defense-in-depth filter on top of the
    classifier prompt — if the LLM still emits a region, we refuse to
    copy it into day_plan.city.
    """
    if not name:
        return True
    n = name.strip().lower()
    if not n:
        return True
    # Compass-direction prefixes. English + Portuguese + Spanish.
    compass_prefixes = (
        "northern ", "southern ", "eastern ", "western ",
        "north ", "south ", "east ", "west ",
        "norte ", "sul ", "leste ", "oeste ",
        "norte de ", "sul de ", "leste de ", "oeste de ",
        "norte do ", "sul do ", "leste do ", "oeste do ",
        "norte da ", "sul da ", "leste da ", "oeste da ",
        "north of ", "south of ", "east of ", "west of ",
    )
    for prefix in compass_prefixes:
        if n.startswith(prefix):
            return True
    # Compass-direction suffixes (Portuguese "X do Norte / da Costa").
    compass_suffixes = (
        " do norte", " do sul", " do leste", " do oeste",
        " da costa", " do interior",
        " do nordeste", " do sudeste", " do noroeste", " do sudoeste",
        " del norte", " del sur",
        " north", " south", " east", " west",
    )
    for suffix in compass_suffixes:
        if n.endswith(suffix):
            return True
    # Generic "region/area" tokens that, even as substrings, signal a
    # non-city label.
    generic_tokens = (
        "region", "regiao", "região", "zona", "area", "área",
        "highlands", "lowlands", "coast", "coastline", "litoral",
        "interior", "outback", "countryside", "campo",
    )
    tokens = n.replace(",", " ").split()
    if any(tok in generic_tokens for tok in tokens):
        return True
    # "Islands" at the end (not in the middle — "Phi Phi Islands" is OK
    # but "Thai Islands" isn't). Heuristic: only the last token.
    if tokens and tokens[-1] in {"islands", "ilhas", "islas"}:
        # Allow well-known archipelago names where "islands" IS part of
        # the proper noun (Phi Phi, Galápagos, Canary).
        known_archipelagos = {
            "phi phi", "galapagos", "galápagos", "canary", "canárias",
            "balearic", "baleares",
        }
        joined = " ".join(tokens[:-1])
        if joined not in known_archipelagos:
            return True
    return False


async def _assign_day_rigidity(
    trip: dict,
    day_plans: list[dict],
    content_classification: dict,
    rails: RailsClient,
) -> dict[int, str]:
    """Compute each day's rigidity from the classifier's canonical_days, then
    persist the metadata on the Rails day_plan so the frontend can render
    badges and the refine flow can respect "locked" days.

    Returns a dict `{day_number: rigidity_string}` the prompt + post-processing
    pipeline will read. Persistence uses `rails.update_day_plan` (PATCH) and
    is best-effort: logs on failure, never raises.

    Rules (from the approved plan):
      - canonical_days[N] exists with confidence >= 0.8 → rigidity=locked,
        origin=from_video. Persists source_video_url, source_creator_handle,
        primary_region, day_type (day_trip if is_day_trip else urban).
      - canonical_days[N] exists with 0.5 <= confidence < 0.8 → partially_flexible.
      - No canonical_days[N] → flexible, origin=ai_created.
    """
    canonical_days = content_classification.get("canonical_days") or {}
    creators_by_day = content_classification.get("creator_handles_by_day") or {}
    day_rigidity: dict[int, str] = {}

    # Normalize canonical_days keys — _resolve_multi_video_conflicts uses int
    # keys, but JSON roundtrips may turn them into strings.
    normalized_cd: dict[int, dict] = {}
    for k, v in canonical_days.items():
        try:
            normalized_cd[int(k)] = v
        except (TypeError, ValueError):
            continue

    # ── Multi-base city distribution ─────────────────────────────────
    # When the destination classifier detected a multi_base trip (e.g. 15-day
    # Thailand across Bangkok + Chiang Mai + Phuket + Koh Lipe), distribute
    # the flexible days across base_cities. Without this, the fallback
    # `base_city` (singular) from the video classifier gets applied to ALL
    # days → every day goes to Bangkok → Google Places rejects places 700km
    # away → user sees Phuket content forced into Bangkok cards.
    #
    # Two sources, in priority order:
    #   1. User-confirmed distribution via CityDistributionModal — stored at
    #      traveler_profile.city_distribution with status="confirmed". The
    #      user picked which cities to include and how many days each.
    #   2. Legacy proportional fallback — 15 days ÷ 4 cities = ~3-4 days each,
    #      remainder distributed to earlier bases so 15/4 = [4, 4, 4, 3]. Used
    #      for trips that predate the modal or never paused (edge cases).
    #
    # Days covered by canonical_days (from structured video) take priority
    # over either source — their region_hint wins.
    profile_for_multi = trip.get("traveler_profile") or {}
    dest_classification = profile_for_multi.get("destination_classification") or {}
    city_distribution = profile_for_multi.get("city_distribution") or {}
    day_num_list = sorted(
        [dp["day_number"] for dp in day_plans if isinstance(dp.get("day_number"), int)]
    )
    day_to_base_city: dict[int, str] = {}

    if city_distribution.get("status") == "confirmed" and day_num_list:
        selected = [
            str(c).strip() for c in (city_distribution.get("selected_cities") or [])
            if c and str(c).strip()
        ]
        day_dist = city_distribution.get("day_distribution") or {}
        cursor = 0
        for city in selected:
            share = int(day_dist.get(city, 0))
            for dnum in day_num_list[cursor:cursor + share]:
                day_to_base_city[dnum] = city
            cursor += share
        logger.info(
            "[rigidity] User-confirmed multi-base distribution: %s", day_dist,
        )
    elif dest_classification.get("destination_type") == "multi_base" and day_num_list:
        raw_bases = [
            str(c).strip() for c in (dest_classification.get("base_cities") or [])
            if c and str(c).strip()
        ]
        if len(raw_bases) >= 2:
            day_dist_legacy = _proportional_distribution(len(day_num_list), raw_bases)
            cursor = 0
            for city, share in day_dist_legacy.items():
                for dnum in day_num_list[cursor:cursor + share]:
                    day_to_base_city[dnum] = city
                cursor += share
            logger.info(
                "[rigidity] Legacy multi-base proportional distribution: %s",
                day_dist_legacy,
            )

    # Build every patch payload first, compute day_rigidity synchronously.
    pending_patches: list[tuple[int, int, dict]] = []  # (day_num, dp_id, patch)
    pace = (content_classification.get("pace_signals") or {}).get("pace")

    for dp in day_plans:
        day_num = dp.get("day_number")
        if not isinstance(day_num, int):
            continue

        entry = normalized_cd.get(day_num)
        patch: dict = {}
        if entry:
            confidence = float(entry.get("confidence") or 0.0)
            rigidity = "locked" if confidence >= 0.8 else "partially_flexible"
            patch["rigidity"] = rigidity
            patch["origin"] = "from_video"
            if entry.get("source_url"):
                patch["source_video_url"] = entry["source_url"]
            creator = creators_by_day.get(day_num) or entry.get("creator")
            if creator:
                patch["source_creator_handle"] = creator
            # Persist the base city for this day. Priority order:
            # 1. region_hint from classifier (most specific — video said so)
            # 2. multi_base distribution (structured destination knowledge)
            # 3. singular base_city fallback (single-destination trips)
            # Each candidate is filtered through _is_generic_region — if
            # region_hint is "Northern Thailand" we skip it and fall through
            # to day_to_base_city, which should have been constrained to
            # specific cities by the classifier prompt. Last-resort empty
            # string is better than polluting day_plan.city with a region.
            def _pick_city(*candidates: str) -> str:
                for c in candidates:
                    if isinstance(c, str) and c.strip() and not _is_generic_region(c):
                        return c.strip()
                for c in candidates:
                    if isinstance(c, str) and c.strip():
                        logger.warning(
                            "[rigidity] rejecting generic region label '%s' for day %s",
                            c, day_num,
                        )
                return ""
            city_for_day = _pick_city(
                entry.get("region_hint") or "",
                day_to_base_city.get(day_num) or "",
                content_classification.get("base_city") or "",
            )
            if city_for_day:
                patch["primary_region"] = city_for_day
                patch["city"] = city_for_day
            patch["day_type"] = "day_trip" if entry.get("is_day_trip") else "urban"
        else:
            rigidity = "flexible"
            patch["rigidity"] = "flexible"
            patch["origin"] = "ai_created"
            patch["day_type"] = "urban"
            # For flexible days in a multi_base trip, use the distribution
            # map so consecutive days share a base. For single-base trips,
            # fall back to the singular `base_city` from the classifier.
            candidates_flex = [
                day_to_base_city.get(day_num) or "",
                content_classification.get("base_city") or "",
            ]
            city_for_day = ""
            for c in candidates_flex:
                if isinstance(c, str) and c.strip() and not _is_generic_region(c):
                    city_for_day = c.strip()
                    break
            if not city_for_day:
                for c in candidates_flex:
                    if isinstance(c, str) and c.strip():
                        logger.warning(
                            "[rigidity] rejecting generic region label '%s' for flex day %s",
                            c, day_num,
                        )
            if city_for_day:
                patch["city"] = city_for_day

        # Only include `estimated_pace` when it matches the Rails enum —
        # Haiku sometimes returns English or misspelled variants ("medium",
        # "slow", "leve.") which would 422 the whole PATCH, failing ALL the
        # other valid fields on the day. Normalize and validate here.
        VALID_PACES = {"leve", "moderado", "acelerado"}
        if pace:
            normalized_pace = str(pace).strip().lower()
            # Common translation fallback.
            pace_aliases = {
                "slow": "leve", "light": "leve", "relaxed": "leve",
                "medium": "moderado", "moderate": "moderado",
                "fast": "acelerado", "intense": "acelerado", "packed": "acelerado",
            }
            normalized_pace = pace_aliases.get(normalized_pace, normalized_pace)
            if normalized_pace in VALID_PACES:
                patch["estimated_pace"] = normalized_pace
            else:
                logger.warning(
                    "[rigidity] Ignoring invalid pace=%r for day %d (not in %s)",
                    pace, day_num, VALID_PACES,
                )

        # Hard-enforce every enum against Rails' whitelist so a bad classifier
        # response can't 422 the whole day. We drop the field instead of
        # sending an invalid value.
        VALID_RIGIDITIES = {"locked", "partially_flexible", "flexible"}
        VALID_ORIGINS = {"from_video", "ai_created", "user_edited"}
        VALID_DAY_TYPES = {"urban", "day_trip", "transfer"}
        if patch.get("rigidity") not in VALID_RIGIDITIES:
            logger.warning("[rigidity] Invalid rigidity=%r → flexible", patch.get("rigidity"))
            patch["rigidity"] = "flexible"
        if patch.get("origin") not in VALID_ORIGINS:
            logger.warning("[rigidity] Invalid origin=%r → ai_created", patch.get("origin"))
            patch["origin"] = "ai_created"
        if patch.get("day_type") not in VALID_DAY_TYPES:
            logger.warning("[rigidity] Invalid day_type=%r → urban", patch.get("day_type"))
            patch["day_type"] = "urban"

        day_rigidity[day_num] = rigidity
        pending_patches.append((day_num, dp["id"], patch))

        # CRITICAL: mutate the in-memory dp dict too. Downstream functions
        # (_validate_and_create_items, cluster tightening, multi-city fence
        # detection) read `dp["city"]` directly from this list — the Rails
        # PATCH alone doesn't help because the list isn't refetched before
        # those functions run.
        if patch.get("city"):
            dp["city"] = patch["city"]
        if patch.get("primary_region"):
            dp["primary_region"] = patch["primary_region"]
        if patch.get("day_type"):
            dp["day_type"] = patch["day_type"]
        if patch.get("rigidity"):
            dp["rigidity"] = patch["rigidity"]
        if patch.get("origin"):
            dp["origin"] = patch["origin"]

    # Now fire every PATCH in parallel — before this change a 10-day trip
    # did 10 sequential round-trips to Rails, which on Render's free tier
    # (with spin-up latency) could take 5+ seconds by itself.
    async def _one_patch(day_num: int, dp_id: int, patch: dict):
        try:
            await rails.update_day_plan(trip["id"], dp_id, patch)
            logger.info(
                "[rigidity] Day %d → %s (origin=%s day_type=%s city=%s)",
                day_num, patch.get("rigidity"), patch.get("origin"),
                patch.get("day_type"), patch.get("city") or "-",
            )
        except Exception as e:
            logger.warning("[rigidity] Failed to persist day %d: %s", day_num, e)

    await asyncio.gather(*[_one_patch(d, i, p) for d, i, p in pending_patches])
    return day_rigidity


# Keywords that mark an item as an EXPERIENCE (activity without a fixed
# map location), not a geocodable place. When detected we skip the Google
# Places search and instead ask Haiku for 2-3 venue recommendations in the
# destination — so the user sees "Show de tango — Rojo Tango, Café Tortoni,
# El Viejo Almacén" instead of the item being silently dropped because
# Google couldn't match it to a single pin.
_EXPERIENCE_KEYWORDS_PT = {
    "show de tango", "aula de tango", "tango show",
    "passeio de barco", "passeio de lancha", "passeio em barco",
    "bate-volta", "day trip",
    "aula de ", "curso de ", "workshop",
    "show ", "apresentação", "espetáculo",
    "degustação", "tasting", "wine tour", "tour de vinho",
    "tour gastronômico", "food tour",
    "tour de bike", "bike tour", "tour a pé", "walking tour",
    "catamarã", "catamara",
    "experiência", "experiencia", "vivência", "vivencia",
    "sunset ", "pôr do sol ", "por do sol ",
}


def _looks_like_experience(name: str) -> bool:
    """Heuristic: does this name describe an activity/experience rather
    than a geocodable landmark? Conservative on purpose — returning False
    means we do try Google Places; returning True means we skip Places
    and emit venue recommendations via Haiku.
    """
    if not name:
        return False
    low = name.lower()
    return any(k in low for k in _EXPERIENCE_KEYWORDS_PT)


def _build_place_list_from_canonical_days(
    canonical_days: dict[int, dict], day_plans: list[dict],
) -> list[dict]:
    """Fast path — skip Sonnet entirely when every scheduled day is locked.

    When the classifier returned canonical_days with the exact place list for
    each trip day, we already know what the user wants. Building the place_list
    from this data directly cuts 15-30 seconds of Sonnet latency plus verify
    and audit that would both be no-ops (all days locked = nothing to edit).

    Time slots are assigned heuristically by position within the day (10:00,
    12:30, 14:30, 16:30, 19:00) — mirrors the prompt's default rhythm.
    """
    default_slots = ["10:00", "12:30", "14:30", "16:30", "19:00"]
    default_durations = [90, 60, 90, 90, 90]
    place_list: list[dict] = []

    for dp in day_plans:
        day_num = dp.get("day_number")
        entry = canonical_days.get(day_num)
        if not entry:
            continue
        places_on_day = entry.get("places") or []
        hints_on_day = entry.get("activity_hints") or []
        # Each hint becomes an item marked as experience so
        # _validate_and_create_items treats it like a free-text activity
        # and fetches top-3 venue recommendations. This preserves the
        # creator's guidance even without a proper noun.
        combined = [(name, False) for name in places_on_day[:5]]
        # Fill remaining day slots with hints if there's room.
        room_left = max(0, 5 - len(combined))
        for hint in hints_on_day[:room_left]:
            combined.append((hint, True))

        for i, (name, is_hint) in enumerate(combined):
            is_exp = is_hint or _looks_like_experience(name)
            place_list.append({
                "day": day_num,
                "name": name,
                # Experiences go into "activity"; fixed places stay "attraction".
                "category": "activity" if is_exp else "attraction",
                "time_slot": default_slots[min(i, 4)],
                "duration_minutes": default_durations[min(i, 4)],
                "description": "",
                "notes": "",
                "vibe_tags": ["experiencia"] if is_exp else [],
                "alerts": [],
                "source": "link",
                "source_url": entry.get("source_url"),
                # Internal flag — read by _validate_and_create_items to
                # skip Places and emit venue recommendations instead.
                "_is_experience": is_exp,
            })
    return place_list


async def _build_itinerary_eco(
    trip: dict,
    day_plans: list[dict],
    existing_items: list[str],
    combined_content: str,
    source_urls: list[str],
    links: list[dict],
    rails: RailsClient,
    places: GooglePlacesClient,
    cost: CostTracker,
    trip_id: int,
) -> dict:
    """Eco Phase 2: ONE structured Sonnet call → JSON place list → verify → validate + create.

    Phase 3: the profile may contain a `content_classification` blob (produced
    by `_classify_and_extract` + `_resolve_multi_video_conflicts`). When present
    we assign day rigidity FIRST, persist it on the Rails day_plans, then pass
    the `day_rigidity` map to every post-processing guard so locked days from
    a D-category video are left alone.

    UX perf (user report: 10 minutes unacceptable): when every scheduled day
    is covered by locked canonical_days, we skip Sonnet + verify + audit and
    build items directly from the classifier output. That cuts the build
    from minutes to under a minute — the user already has the content they
    wanted, the AI was only rephrasing it.
    """
    profile = trip.get("traveler_profile") or {}
    places_mentioned = profile.get("places_mentioned", [])
    day_plans_from_links = profile.get("day_plans_from_links", [])
    content_classification = profile.get("content_classification") or {}

    # Phase 3.1 — assign rigidity + persist on Rails before the Sonnet call.
    day_rigidity: dict[int, str] = {}
    canonical_days: dict[int, dict] = {}
    if content_classification:
        day_rigidity = await _assign_day_rigidity(
            trip, day_plans, content_classification, rails,
        )
        # Normalize canonical_days keys to int for downstream use.
        raw_cd = content_classification.get("canonical_days") or {}
        for k, v in raw_cd.items():
            try:
                canonical_days[int(k)] = v
            except (TypeError, ValueError):
                continue

    # Fast path: skip the 30-60s Sonnet call when the classifier already has
    # every scheduled day covered with locked data. Kicks in when a D-category
    # video (or multi-video consolidation) fills every day_plan.
    #
    # IMPORTANT — we now DISABLE the fast path for multi_base and tour_driven
    # destinations AND whenever the classifier emitted activity_hints. Those
    # scenarios need Sonnet's reasoning to (a) resolve hints into concrete
    # named venues, (b) structure transfer days between bases, (c) apply the
    # "no generic category items" hard rule. The fast path skipped all of
    # that and was producing cards titled "rooftop bars" / "temples" /
    # "Thai culture" — the exact user complaint.
    num_scheduled_days = len(day_plans)
    dest_type_from_profile = (
        (profile.get("destination_classification") or {}).get("destination_type")
    )
    any_day_has_hints = any(
        bool((entry or {}).get("activity_hints"))
        for entry in canonical_days.values()
    )
    fast_path_unsafe = (
        dest_type_from_profile in {"multi_base", "tour_driven"}
        or any_day_has_hints
    )
    fast_path = (
        not fast_path_unsafe
        and num_scheduled_days > 0
        and len(canonical_days) >= num_scheduled_days
        and all(
            day_rigidity.get(dp["day_number"]) == "locked" for dp in day_plans
        )
    )
    if fast_path_unsafe and len(canonical_days) >= num_scheduled_days:
        logger.info(
            "[eco] FAST PATH skipped — destination_type=%s any_hints=%s. "
            "Using Sonnet so hints resolve to concrete named venues and "
            "multi-base transfer structure gets applied.",
            dest_type_from_profile, any_day_has_hints,
        )

    place_list: list[dict] | None
    if fast_path:
        logger.info(
            "[eco] FAST PATH — %d/%d days locked, skipping Sonnet/verify/audit",
            len(canonical_days), num_scheduled_days,
        )
        place_list = _build_place_list_from_canonical_days(canonical_days, day_plans)
        if not place_list:
            # Safety: classifier said locked but emitted zero places. Fall
            # through to the normal path instead of creating an empty trip.
            logger.warning("[eco] Fast path yielded 0 places, falling back to Sonnet")
            fast_path = False

    if not fast_path:
        prompt = _build_itinerary_prompt(
            combined_content, trip, day_plans, existing_items,
            source_urls, places_mentioned, day_plans_from_links,
            canonical_days=canonical_days,
            day_rigidity=day_rigidity,
        )
        expected_items = len(day_plans) * 5
        place_list = await _call_claude_for_itinerary(
            prompt,
            cost,
            expected_items=expected_items,
            num_days=len(day_plans),
        )

    if not place_list:
        return {"error": "Itinerary generation failed", "places_created": 0}

    logger.info("[eco] Generated %d places (fast_path=%s)", len(place_list), fast_path)

    # In fast path every item already has source="link" with source_url set,
    # and there's no Sonnet output to reconcile — skip the tag + ensure +
    # dedup + rebalance + verify + audit steps that cost 20-60 seconds of
    # Haiku calls. Go straight to Google Places validation + item creation.
    if not fast_path:
        # Force-tag sources programmatically (Claude often ignores the instruction)
        place_list = _tag_sources_from_links(place_list, places_mentioned)

        # Safety net: inject any link places Claude dropped
        place_list = _ensure_link_places_present(place_list, places_mentioned, day_plans)

        # Remove duplicates (handles language variants like "Cemitério da Recoleta"
        # vs "Cemitério de la Recoleta" — same place)
        place_list = _deduplicate_places(place_list)

        # Phase 3.4 — semantic dedup catches things the name-based pass can't
        # (e.g. "Cristo Redentor" == "Christ the Redeemer", or two items with
        # different names but coordinates within 150m).
        place_list = _semantic_deduplicate(place_list)

        place_list = _rebalance_days(place_list, len(day_plans), day_rigidity=day_rigidity)

        # Phase 3.6 — any day that the classifier marked as is_day_trip but ended
        # up too thin (<3 items) gets a dedicated fill-in from Haiku so the
        # traveler has a real day in the secondary city (Tigre, Versailles, etc.)
        # instead of a lone "Tigre" line item.
        if canonical_days:
            by_day: dict[int, list[dict]] = {}
            for p in place_list:
                d = p.get("day")
                if isinstance(d, int):
                    by_day.setdefault(d, []).append(p)
            for day_num, entry in canonical_days.items():
                if not isinstance(entry, dict) or not entry.get("is_day_trip"):
                    continue
                current = by_day.get(day_num, [])
                if len(current) >= 3:
                    continue
                dest_city = entry.get("region_hint") or (entry.get("places") or [None])[0]
                if not dest_city:
                    continue
                built = await _build_day_trip(
                    base_city=trip.get("destination", "").split(",")[0].strip(),
                    destination_city=dest_city,
                    target_day=day_num,
                    mentioned_duration_hours=None,
                    pattern_signature=None,
                    cost=cost,
                )
                if built:
                    place_list.extend(built)
                    logger.info(
                        "[day-trip] Added %d items to Day %d (%s)",
                        len(built), day_num, dest_city,
                    )

        # Previous versions ran verify + audit + experiences INSIDE the build
        # (up to 145s extra). That was the main reason the 240s wrapper kept
        # timing out → 0 items → 95 % loop. Now we SKIP all enrichment in the
        # build. The frontend runs them afterwards as background calls
        # (/optimize-trip + /enrich-experiences) once items are visible, so
        # the user sees the trip FAST and enrichment happens invisibly.
        #
        # The only thing we keep inline is the semantic dedup + cluster
        # tightening, which are cheap and done inside _validate_and_create_items.
        logger.info(
            "[eco] Skipping in-build enrichment (verify/audit/experiences). "
            "Frontend will trigger /enrich-experiences after items land."
        )

    # Final output validation pass — drops destination-as-activity items,
    # injects missing transfer days on multi-base trips, flags thin days.
    # See _validate_and_repair_itinerary for the full rule set (STEPs 6-9
    # of the travel-planning spec).
    place_list, validation_report = _validate_and_repair_itinerary(
        place_list, trip, day_plans, day_rigidity=day_rigidity,
    )

    # STEP 3 — auto-repair thin days with a targeted Sonnet call. Only
    # runs if the validator flagged any; a typical clean build skips this
    # entirely. Budget 50s, fail-open: if it times out we keep the flag.
    if validation_report.get("thin_days"):
        logger.info(
            "[thin-repair] %d thin days detected — running targeted Sonnet repair",
            len(validation_report["thin_days"]),
        )
        place_list = await _repair_thin_days(
            validation_report["thin_days"], place_list, trip, day_plans, cost,
        )
        # Re-run the validator so the report reflects what survived repair.
        place_list, validation_report = _validate_and_repair_itinerary(
            place_list, trip, day_plans, day_rigidity=day_rigidity,
        )
        logger.info(
            "[thin-repair] Post-repair — dropped=%d thin=%d transfers=%d",
            len(validation_report["dropped_destination_as_activity"]),
            len(validation_report["thin_days"]),
            len(validation_report["injected_transfers"]),
        )

    # Persist the report on the profile so the frontend can surface any
    # non-fatal issues (thin days, etc.) as a banner. Best-effort; a
    # failure here doesn't block the build.
    if validation_report.get("total_violations"):
        try:
            refreshed = await rails.get_trip(trip_id)
            profile_blob = (refreshed.get("traveler_profile") or {})
            profile_blob["validation_report"] = validation_report
            await rails.update_trip(
                trip_id, {"traveler_profile": profile_blob},
            )
        except Exception as e:
            logger.warning("[validate] Failed to persist validation_report: %s", e)

    result = await _validate_and_create_items(
        place_list, trip, day_plans, rails, places, cost, trip_id, source_urls,
        day_rigidity=day_rigidity,
    )
    # Echo the validation report on the result so the background task can
    # log it (useful for debugging bad trips in production).
    if validation_report.get("total_violations"):
        result["validation_report"] = validation_report

    # Phase 3.5 — persist pattern signatures for locked/partially_flexible days.
    # This records the "flavor" of video-sourced days (density, category mix,
    # vibes) so the refine flow and future multi-video merges can replicate
    # the traveler's rhythm on flexible days.
    try:
        items_by_day: dict[int, list[dict]] = {}
        for p in place_list:
            d = p.get("day")
            if isinstance(d, int):
                items_by_day.setdefault(d, []).append(p)

        # Compute signatures synchronously, then persist every one of them in
        # parallel so a locked 10-day trip doesn't take 10× Rails round-trips.
        pending_sigs: list[tuple[int, int, dict]] = []
        for dp in day_plans:
            day_num = dp.get("day_number")
            if not isinstance(day_num, int):
                continue
            if day_rigidity.get(day_num, "flexible") == "flexible":
                continue
            signature = _compute_day_signature(items_by_day.get(day_num, []))
            if signature:
                pending_sigs.append((day_num, dp["id"], signature))

        async def _persist_sig(day_num: int, dp_id: int, signature: dict):
            try:
                await rails.update_day_plan(
                    trip["id"], dp_id, {"pattern_signature": signature},
                )
                logger.info("[pattern-sig] Day %d → %s", day_num, signature)
            except Exception as e:
                logger.warning("[pattern-sig] Failed to persist day %d: %s", day_num, e)

        if pending_sigs:
            await asyncio.gather(
                *[_persist_sig(d, i, s) for d, i, s in pending_sigs]
            )
    except Exception as e:
        logger.warning("[pattern-sig] Non-fatal error in signature step: %s", e)

    return result


# ──────────────────────────────────────────────
# PHASE 2 — PRO: Agentic loop with tools
# ──────────────────────────────────────────────


async def _build_itinerary_pro(
    trip: dict,
    day_plans: list[dict],
    existing_items: list[str],
    combined_content: str,
    source_urls: list[str],
    rails: RailsClient,
    places: GooglePlacesClient,
    cost: CostTracker,
    trip_id: int,
) -> dict:
    """Pro Phase 2: Agentic Sonnet loop with validate_places + create_batch tools.

    Uses the TravelAgent with a unified prompt that includes:
    - All aggregated content from extracted links
    - Confirmed traveler profile (style, pace, interests)
    - City day distribution (which days → which city)
    """
    from app.ai.prompts import build_unified_prompt

    profile = trip.get("traveler_profile") or {}
    places_mentioned = profile.get("places_mentioned", [])
    day_plans_from_links = profile.get("day_plans_from_links", [])
    destination = trip.get("destination", "")

    # Get destination coordinates for geographic validation
    dest_coords = await _get_destination_coords(destination, places)
    cities_in_plans = set()
    for dp in day_plans:
        c = dp.get("city")
        if c:
            cities_in_plans.add(c)
    max_dist = 300 if len(cities_in_plans) > 1 else 150

    handlers = ToolHandlers(
        rails_client=rails,
        places_client=places,
        places_mentioned=places_mentioned,
        destination=destination,
        destination_coords=dest_coords,
        max_distance_km=max_dist,
    )
    agent = TravelAgent(
        tool_handlers=handlers,
        cost_tracker=cost,
        model="claude-sonnet-4-20250514",
        max_turns=15,
    )

    try:
        result = await agent.build_itinerary(
            trip_id=trip_id,
            trip_name=trip.get("name", ""),
            trip_destination=trip.get("destination"),
            day_plans=day_plans,
            existing_items=existing_items,
            combined_content=combined_content,
            profile=profile,
            source_urls=source_urls,
            places_mentioned=places_mentioned,
            day_plans_from_links=day_plans_from_links,
        )
    except Exception as e:
        logger.error("[pro] Agent itinerary build failed: %s", e)
        return {"error": str(e), "places_created": 0}

    return result


# ──────────────────────────────────────────────
# REFINE ITINERARY — User Feedback
# ──────────────────────────────────────────────


async def refine_itinerary(
    trip_id: int,
    feedback: str,
    scope: str = "trip",
    day_plan_id: int | None = None,
    http_client=None,
) -> dict:
    """Refine existing itinerary based on user feedback.

    scope="trip": regenerate all days based on feedback
    scope="day": regenerate only the specified day_plan_id
    """
    rails = RailsClient(client=http_client)
    places = GooglePlacesClient(http_client=http_client)
    cost = CostTracker(link_id=0)

    try:
        trip = await rails.get_trip(trip_id)
        day_plans_raw = await rails.get_day_plans(trip_id)
    except Exception as e:
        logger.error("[refine] Failed to fetch trip %d: %s", trip_id, e)
        return {"error": str(e), "places_created": 0}

    # Build day plan info with existing items
    day_plans = []
    for dp in day_plans_raw:
        day_plans.append({
            "id": dp["id"],
            "day_number": dp["day_number"],
            "date": dp.get("date"),
            "city": dp.get("city"),
            "itinerary_items": dp.get("itinerary_items", []),
        })

    # Get original link content for context
    links = trip.get("links", [])
    if not links:
        try:
            links = await rails.get_links(trip_id)
        except Exception:
            links = []

    content_parts = []
    source_urls = []
    for link in links:
        extracted = link.get("extracted_data") or {}
        ct = extracted.get("content_text", "")
        if ct:
            url = link.get("url", "")
            content_parts.append(f"--- Source: {url} ---\n{ct}")
            source_urls.append(url)
    combined_content = "\n\n".join(content_parts) if content_parts else ""

    profile = trip.get("traveler_profile") or {}
    places_mentioned = profile.get("places_mentioned", [])
    destination = trip.get("destination", "a destination")

    # Determine which days to refine
    if scope == "day" and day_plan_id:
        target_days = [dp for dp in day_plans if dp["id"] == day_plan_id]
        keep_days = [dp for dp in day_plans if dp["id"] != day_plan_id]
    else:
        target_days = day_plans
        keep_days = []

    if not target_days:
        return {"error": "No matching day plan found", "places_created": 0}

    # Build context of what to keep (for day-level, show other days as context)
    keep_context = ""
    if keep_days:
        keep_lines = []
        for dp in keep_days:
            items = dp.get("itinerary_items", [])
            item_names = [f"  - {it.get('name', '?')} ({it.get('category', '?')}, {it.get('time_slot', '?')})" for it in items]
            keep_lines.append(f"Day {dp['day_number']} (KEEP — do not change):\n" + "\n".join(item_names))
        keep_context = "\n".join(keep_lines)

    # Build context of current items in target days. Every item is listed
    # WITH ITS DATABASE ID so the Sonnet output can reuse the same id for
    # untouched items — the upsert pass matches by id and PATCHes in place,
    # preserving personal_notes and position. Items marked 🔒 carry
    # origin=extracted_from_video and MUST NOT be removed.
    current_items_text = ""
    current_lines = []
    locked_ids: set[int] = set()
    existing_ids_by_day: dict[int, list[int]] = {}
    for dp in target_days:
        items = dp.get("itinerary_items", [])
        item_lines: list[str] = []
        for it in items:
            item_id = it.get("id")
            origin = it.get("origin") or (
                "extracted_from_video" if it.get("source") == "link" else "ai_suggested"
            )
            is_locked = origin == "extracted_from_video"
            icon = "🔒" if is_locked else " "
            item_lines.append(
                f"  {icon} id={item_id} | {it.get('name', '?')} "
                f"({it.get('category', '?')}, {it.get('time_slot', '?')}, origin: {origin})"
            )
            if item_id:
                existing_ids_by_day.setdefault(dp["day_number"], []).append(item_id)
                if is_locked:
                    locked_ids.add(item_id)
        current_lines.append(
            f"Day {dp['day_number']} (REFINE based on feedback):\n"
            + "\n".join(item_lines)
        )
    current_items_text = "\n".join(current_lines)

    # Places from links section
    places_section = ""
    if places_mentioned:
        place_lines = [f"- {p['name']}" for p in places_mentioned]
        places_section = f"""
PLACES FROM USER'S LINKS (preserve these when possible — tag as source: "link"):
{chr(10).join(place_lines)}
"""

    num_target_days = len(target_days)
    total_items_needed = num_target_days * 5

    # Detect a day-trip request — keywords in pt-BR + EN that map to "user
    # wants to dedicate a full day to a single destination". When this hits,
    # the prompt switches to a SURGICAL mode: replace exactly one day with
    # a day-trip + leave everything else intact.
    feedback_lower = (feedback or "").lower()
    DAY_TRIP_PATTERNS = (
        "dia inteiro em ", "passar o dia em ", "um dia em ",
        "bate-volta", "bate e volta", "bate volta", "day trip to ",
        "full day in ", "full day at ", "spend a day in ",
    )
    is_day_trip_request = any(p in feedback_lower for p in DAY_TRIP_PATTERNS)

    # Identify flexible (non-locked) day_numbers — these are the ones the
    # refine is allowed to fully reshape. Locked days from the source video
    # stay sacred.
    flexible_day_numbers = []
    for dp in target_days:
        items = dp.get("itinerary_items", [])
        has_locked = any(
            (it.get("origin") or "") == "extracted_from_video"
            or it.get("source") == "link"
            for it in items
        )
        if not has_locked:
            flexible_day_numbers.append(dp["day_number"])

    surgical_block = ""
    if is_day_trip_request:
        flex_str = ", ".join(str(d) for d in flexible_day_numbers) or "(none — all locked)"
        surgical_block = f"""
╔═══════════════════════════════════════════════════════════════════╗
║  ⚡ DAY-TRIP REQUEST DETECTED — SURGICAL MODE                     ║
╚═══════════════════════════════════════════════════════════════════╝
The user is asking for a FULL-DAY day trip. You MUST:

1. Pick EXACTLY ONE day from this set (flexible only, never locked): {flex_str}
   Prefer the LAST flexible day if multiple exist.

2. On that ONE day, REPLACE all current items with a structured day-trip:
   • Item 1: the day-trip destination itself, duration_minutes=480 (8h),
     activity_model="day_trip", item_role="day_trip_destination",
     time_slot="09:00".
   • Items 2-3: 1-2 anchored experiences IN THE DAY-TRIP DESTINATION
     CITY (e.g. Puerto de Frutos in Tigre, lunch in Tigre). Never
     attractions from the base city.

3. EVERY OTHER DAY stays IDENTICAL. Return every existing item from
   those days WITH ITS SAME id. Do NOT omit any item from non-target
   days. Do NOT change name/time_slot/duration on those days.

4. Total items in the output ≈ (current_total - replaced_day_count + 3).
   You are NOT regenerating the trip. You are surgically replacing
   ONE day. Verify by counting before responding.
"""

    # Build the refine prompt. Phase 4: include id + origin on every line so
    # the output can reuse ids (upsert) instead of regenerating everything.
    prompt = f"""You are an expert travel planner. The user already has an itinerary for {destination} and is asking for a SPECIFIC change. Your job is to make the SMALLEST possible modification to satisfy their feedback — not to redesign the trip.

USER'S FEEDBACK:
"{feedback}"

CURRENT ITINERARY (items to REFINE — ids in parens):
{current_items_text}

{"DAYS TO KEEP UNCHANGED (for context only):" + chr(10) + keep_context if keep_context else ""}

TRAVELER PROFILE:
- Style: {profile.get('travel_style', '')}
- Interests: {', '.join(profile.get('interests', []))}
- Pace: {profile.get('pace', 'moderate')}
{places_section}
{surgical_block}

PRINCIPLE OF MINIMAL CHANGE (NON-NEGOTIABLE):
- The user picked a specific thing to change. Don't touch anything else.
- If the feedback says "more restaurants on day 2" → only edit day 2.
- If the feedback says "I want a day in Tigre" → see DAY-TRIP REQUEST block above.
- Default behavior is KEEP every existing item with its original id. Only
  change what the feedback explicitly asks for.

UPSERT RULES (MUST FOLLOW — this is how we avoid losing user annotations):
1. To KEEP an existing item untouched: return it with its SAME `id`. You may
   edit its name/time_slot/duration if the feedback justifies; keep the id.
2. To REPLACE an existing item: return a new object WITHOUT `id` (then the
   system will DELETE the old one and CREATE this one). Leave id out.
3. 🔒 LOCKED ITEMS (origin=extracted_from_video): NEVER omit them from the
   output and NEVER change their day. If the feedback would require removing
   one, STILL include it as-is and the system will surface a conflict modal
   for the user to confirm — your job is to preserve them in the output.
4. To ADD a new item: return it WITHOUT `id`.
5. If an existing item is not in your output, the system treats it as
   "the user wants this gone" — it will be deleted UNLESS it's 🔒 locked.

OTHER INSTRUCTIONS:
- Maintain 4-5 items per day, geographic clustering, and time flow ON THE DAYS YOU ACTUALLY EDIT.
- LINK CONTENT HAS PRIORITY: Items with origin=extracted_from_video MUST be
  kept on their assigned day, and their id MUST appear in your output.

Return ONLY a JSON array. Each object:
{{"id": <existing id OR omit for new items>, "day": <day_number>, "name": "Exact Place Name", "category": "restaurant|attraction|activity|shopping|cafe|nightlife|other", "time_slot": "09:00", "duration_minutes": 90, "description": "Why this is great + practical tip in Portuguese.", "notes": "Insider tip in Portuguese.", "vibe_tags": ["tag1", "tag2"], "alerts": ["alert if relevant"], "source": "link|ai", "activity_model": "direct_place|day_trip|anchored_experience", "item_role": "attraction|day_trip_destination|experience_activity|restaurant"}}

Day numbers available: {', '.join(str(dp['day_number']) for dp in target_days)}.
Total items in output should be approximately the SAME count as the current itinerary above (you are editing, not expanding).

PORTUGUESE GRAMMAR (MANDATORY): ALL text fields (description, notes, alerts) MUST use PERFECT Brazilian Portuguese (pt-BR) with proper accents (á, é, í, ó, ú, â, ê, ô, ã, õ, à), cedilla (ç), and punctuation. NEVER omit accents.

{"Original link content (for reference):" + chr(10) + combined_content[:4000] if combined_content else ""}"""

    # Call Claude
    place_list = await _call_claude_for_itinerary(
        prompt,
        cost,
        expected_items=total_items_needed,
        num_days=num_target_days,
    )

    if not place_list:
        return {"error": "Refine generation failed", "places_created": 0}

    logger.info("[refine] Claude generated %d replacement places", len(place_list))

    # Force-tag sources programmatically
    place_list = _tag_sources_from_links(place_list, places_mentioned)
    place_list = _ensure_link_places_present(place_list, places_mentioned, target_days)

    # ── Phase 4.1 — upsert-based refine ────────────────────────────────────
    # Partition the Claude output by "has id" (update) vs "no id" (create).
    kept_ids: set[int] = set()
    items_to_update: list[dict] = []
    items_to_create: list[dict] = []
    for item in place_list:
        maybe_id = item.get("id")
        try:
            item_id = int(maybe_id) if maybe_id not in (None, "", 0) else None
        except (TypeError, ValueError):
            item_id = None
        if item_id and item_id in {i for ids in existing_ids_by_day.values() for i in ids}:
            items_to_update.append({**item, "id": item_id})
            kept_ids.add(item_id)
        else:
            # Strip any invalid id so downstream treats it as a new item.
            clean = {k: v for k, v in item.items() if k != "id"}
            items_to_create.append(clean)

    # Items present in DB but missing from Claude output → candidates for
    # deletion (UNLESS locked — those trigger a conflict_alert instead).
    all_existing_ids: set[int] = {
        i for ids in existing_ids_by_day.values() for i in ids
    }
    orphaned_ids = all_existing_ids - kept_ids
    ids_to_delete: list[int] = []
    locked_orphans: list[int] = []
    for oid in orphaned_ids:
        if oid in locked_ids:
            locked_orphans.append(oid)
        else:
            ids_to_delete.append(oid)

    # UPDATE pass — preserves personal_notes, position, IDs.
    updated = 0
    item_by_id: dict[int, dict] = {}
    for dp in target_days:
        for it in dp.get("itinerary_items", []):
            if it.get("id"):
                item_by_id[it["id"]] = {**it, "day_plan_id": dp["id"]}

    for spec in items_to_update:
        item_id = spec["id"]
        original = item_by_id.get(item_id)
        if not original:
            continue
        patch: dict = {}
        for field in (
            "name", "description", "category", "time_slot", "duration_minutes",
            "vibe_tags", "alerts", "alternative_group", "notes",
        ):
            if field in spec and spec[field] is not None:
                patch[field] = spec[field]
        if "day" in spec and isinstance(spec["day"], int):
            target_dp = next(
                (dp for dp in target_days if dp["day_number"] == spec["day"]),
                None,
            )
            # Locked items cannot change day via refine.
            if target_dp and item_id not in locked_ids and target_dp["id"] != original["day_plan_id"]:
                patch["day_plan_id"] = target_dp["id"]
        if not patch:
            continue
        try:
            await rails.update_itinerary_item(
                trip_id, original["day_plan_id"], item_id, patch,
            )
            updated += 1
        except Exception as e:
            logger.warning(
                "[refine] Update failed for id=%s (%s): %s",
                item_id, original.get("name"), e,
            )

    # DELETE pass — non-locked orphans only.
    deleted = 0
    for oid in ids_to_delete:
        original = item_by_id.get(oid)
        if not original:
            continue
        try:
            await rails.delete_itinerary_item(trip_id, original["day_plan_id"], oid)
            deleted += 1
        except Exception as e:
            logger.warning("[refine] Delete failed for id=%s: %s", oid, e)

    # CONFLICT ALERTS for locked items that Claude tried to drop. Attach to
    # the owning day_plan so the frontend can surface a modal.
    if locked_orphans:
        alerts_by_day: dict[int, list[dict]] = {}
        for oid in locked_orphans:
            original = item_by_id.get(oid)
            if not original:
                continue
            day_plan_id = original["day_plan_id"]
            alerts_by_day.setdefault(day_plan_id, []).append({
                "type": "locked_item_removal_attempt",
                "item_id": oid,
                "item_name": original.get("name"),
                "message": (
                    f"O refinamento tentou remover {original.get('name')!r}, "
                    f"que veio do vídeo. Confirma remover, manter ou substituir?"
                ),
                "severity": "high",
                "created_at": __import__("time").strftime("%Y-%m-%dT%H:%M:%SZ"),
            })
        # Merge into each day_plan.conflict_alerts jsonb.
        for dp in target_days:
            new_alerts = alerts_by_day.get(dp["id"])
            if not new_alerts:
                continue
            fresh = await rails.get_day_plans(trip_id)
            current_alerts: list[dict] = []
            for row in fresh:
                if row.get("id") == dp["id"]:
                    current_alerts = row.get("conflict_alerts") or []
                    break
            merged = current_alerts + new_alerts
            try:
                await rails.update_day_plan(
                    trip_id, dp["id"], {"conflict_alerts": merged},
                )
            except Exception as e:
                logger.warning(
                    "[refine] Failed to persist conflict_alerts on day_plan %s: %s",
                    dp["id"], e,
                )

    # CREATE pass — new items go through the full validation + geo pipeline
    # so they land with coordinates + alerts. Reuse the existing function
    # but only feed it the NEW items for the target days.
    created_count = 0
    if items_to_create:
        # The create path needs all day_plans (including untouched) for
        # cluster tightening to make sense.
        all_day_plans_minimal = [
            {"id": dp["id"], "day_number": dp["day_number"], "date": dp.get("date"), "city": dp.get("city")}
            for dp in day_plans
        ]
        create_result = await _validate_and_create_items(
            items_to_create, trip, all_day_plans_minimal, rails, places, cost,
            trip_id, source_urls,
            day_rigidity={
                dp["day_number"]: ("locked" if dp["id"] in {d["id"] for d in target_days if d["id"] in [x["id"] for x in target_days]} else "flexible")
                for dp in all_day_plans_minimal
            } if False else None,  # use None so this create doesn't re-lock days
        )
        created_count = create_result.get("places_created", 0)

    logger.info(
        "[refine] upsert done: updated=%d deleted=%d created=%d conflicts=%d",
        updated, deleted, created_count, len(locked_orphans),
    )

    # Day-trip isolation pass — if the refine introduced a day-trip
    # (duration_minutes >= 300) on a day that still has unrelated urban
    # items, delete the urban items so the day stays a clean day-trip.
    # This catches the "user asked for full day in Tigre" case where
    # Sonnet added Tigre but left "Galeria Pacífico" / "Catedral
    # Metropolitana" on the same day from a previous build.
    if is_day_trip_request and created_count > 0:
        try:
            refreshed_dps = await rails.get_day_plans(trip_id)
            for dp in refreshed_dps:
                items = dp.get("itinerary_items") or []
                dt_items = [
                    it for it in items
                    if (
                        (it.get("activity_model") == "day_trip")
                        or (it.get("item_role") == "day_trip_destination")
                        or (int(it.get("duration_minutes") or 0) >= 300)
                    )
                ]
                if not dt_items:
                    continue
                # The day has at least one day-trip. Build city-allowlist
                # from the day-trip items themselves (case-insensitive).
                allow_cities = set()
                for dt in dt_items:
                    for k in ("city", "primary_region"):
                        v = (dt.get(k) or "").strip().lower()
                        if v:
                            allow_cities.add(v)
                    addr = (dt.get("address") or "").lower()
                    for token in ("tigre", "versailles", "versalhes", "sintra", "colonia"):
                        if token in addr:
                            allow_cities.add(token)
                # Delete every non-daytrip item that isn't in an allowed city.
                isolation_drops = 0
                for it in items:
                    if it in dt_items:
                        continue
                    city = (
                        (it.get("city") or "").strip().lower()
                        or (it.get("primary_region") or "").strip().lower()
                    )
                    addr = (it.get("address") or "").lower()
                    matches = any(c and (c in city or c in addr) for c in allow_cities)
                    if matches:
                        continue
                    # Don't blow away items the user explicitly tagged as
                    # link — those produce conflict_alerts elsewhere. But
                    # for the day-trip case the user EXPLICITLY asked for
                    # the day to be Tigre, so even link items get cleared
                    # (the conflict handling will surface them on a different
                    # day if needed).
                    try:
                        await rails.delete_itinerary_item(trip_id, dp["id"], it["id"])
                        isolation_drops += 1
                    except Exception:
                        logger.warning(
                            "[refine-isolation] could not delete item %s on day %s",
                            it.get("id"), dp.get("day_number"),
                        )
                if isolation_drops:
                    logger.info(
                        "[refine-isolation] day %s: kept %d day-trip item(s), "
                        "removed %d non-matching item(s)",
                        dp.get("day_number"), len(dt_items), isolation_drops,
                    )
        except Exception as e:
            logger.warning("[refine-isolation] non-fatal failure: %s", e)

    return {
        "places_created": created_count,
        "items_updated": updated,
        "items_deleted": deleted,
        "conflicts_pending": len(locked_orphans),
        "summary": f"Refined {len(target_days)} day(s): {updated} updated, "
                   f"{created_count} created, {deleted} removed, "
                   f"{len(locked_orphans)} pending confirmation.",
        "cost": cost.summary(),
    }


# ──────────────────────────────────────────────

async def _mark_failed(rails: RailsClient, trip_id: int, link_id: int, error_message: str):
    try:
        await rails.update_link(trip_id, link_id, status="failed", extracted_data={"error": error_message})
    except Exception as e:
        logger.error("Failed to mark link %d as failed: %s", link_id, e)
