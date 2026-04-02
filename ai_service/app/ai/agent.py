"""
Core Claude agent loop using the Anthropic Messages API with tool_use.

Optimized for cost: prompt caching, history trimming, batch operations.
Target: < $0.30 per link processing.
"""

from __future__ import annotations

import json
import logging

import anthropic

from app.ai.cost_tracker import CostTracker
from app.config import settings
from app.ai.prompts import SYSTEM_PROMPT, UNIFIED_SYSTEM_PROMPT, build_initial_prompt, build_unified_prompt
from app.ai.tool_handlers import ToolHandlers
from app.ai.tools import TOOLS, PHASE2_TOOLS

logger = logging.getLogger(__name__)

MODEL = "claude-sonnet-4-20250514"
MAX_TURNS = 12  # With batch ops, should finish in ~5-7 turns


class TravelAgent:
    """
    Agentic loop that uses Claude with tool_use to extract travel locations
    from social media links and create itinerary items.
    """

    def __init__(
        self,
        tool_handlers: ToolHandlers,
        cost_tracker: CostTracker | None = None,
        model: str = MODEL,
        max_turns: int = MAX_TURNS,
    ):
        self.client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        self.handlers = tool_handlers
        self.cost = cost_tracker or CostTracker()
        self.model = model
        self.max_turns = max_turns

    async def process_link(
        self,
        link_id: int,
        trip_id: int,
        url: str,
        platform: str,
        trip_name: str,
        trip_destination: str | None,
        day_plans: list[dict],
        existing_items: list[str],
    ) -> dict:
        """
        Run the full agentic extraction loop for a single link.

        Returns a result dict with:
          - places_created: number of itinerary items created
          - summary: text summary from Claude
          - cost: token usage and cost info
        """
        self.cost.link_id = link_id

        # Build initial messages
        user_message = build_initial_prompt(
            url=url,
            platform=platform,
            trip_name=trip_name,
            trip_destination=trip_destination,
            day_plans=day_plans,
            existing_items=existing_items,
            trip_id=trip_id,
            link_id=link_id,
        )

        messages = [{"role": "user", "content": user_message}]

        # Context for auto-injection
        self._trip_id = trip_id
        self._link_id = link_id
        self._day_plans = day_plans

        places_created = 0
        final_summary = ""

        # Build system prompt with caching
        system_blocks = [
            {
                "type": "text",
                "text": SYSTEM_PROMPT,
                "cache_control": {"type": "ephemeral"},
            }
        ]

        for turn in range(self.max_turns):
            logger.info(
                "Agent turn %d/%d for link %d", turn + 1, self.max_turns, link_id
            )

            # Call Claude with prompt caching
            response = self.client.messages.create(
                model=self.model,
                max_tokens=8192,
                system=system_blocks,
                tools=TOOLS,
                messages=messages,
            )

            # Track costs
            self.cost.record_usage(response.usage)

            # Log token usage per turn
            usage = response.usage
            logger.info(
                "Turn %d tokens: %d in / %d out (cache read: %s, cache create: %s)",
                turn + 1,
                getattr(usage, "input_tokens", 0),
                getattr(usage, "output_tokens", 0),
                getattr(usage, "cache_read_input_tokens", "n/a"),
                getattr(usage, "cache_creation_input_tokens", "n/a"),
            )

            # Process the response content
            assistant_content = response.content
            messages.append({"role": "assistant", "content": assistant_content})

            # Check stop reason
            if response.stop_reason == "end_turn":
                for block in assistant_content:
                    if hasattr(block, "text"):
                        final_summary = block.text
                logger.info("Agent finished for link %d after %d turns", link_id, turn + 1)
                break

            if response.stop_reason == "tool_use":
                tool_results = []

                for block in assistant_content:
                    if block.type != "tool_use":
                        continue

                    tool_name = block.name
                    tool_input = block.input
                    tool_use_id = block.id

                    logger.info(
                        "Tool call: %s(%s)",
                        tool_name,
                        _truncate(str(tool_input), 200),
                    )
                    self.cost.record_tool_call(tool_name)

                    # Auto-inject and map IDs
                    self._fix_tool_input(tool_name, tool_input)

                    # Execute the tool
                    result_str = await self.handlers.dispatch(tool_name, tool_input)

                    # Track items created
                    if tool_name == "create_batch_itinerary_items":
                        try:
                            r = json.loads(result_str)
                            places_created += r.get("created", 0)
                        except Exception:
                            pass

                    tool_results.append(
                        {
                            "type": "tool_result",
                            "tool_use_id": tool_use_id,
                            "content": _trim_result(result_str),
                        }
                    )

                messages.append({"role": "user", "content": tool_results})

                # Trim old messages to keep context small
                _trim_messages(messages)

            else:
                logger.warning(
                    "Unexpected stop_reason '%s' for link %d",
                    response.stop_reason,
                    link_id,
                )
                break
        else:
            logger.warning(
                "Agent hit max turns (%d) for link %d", self.max_turns, link_id
            )
            final_summary = "Processing stopped: reached maximum number of steps."

        # Log cost summary
        self.cost.log_summary()

        return {
            "places_created": places_created,
            "summary": final_summary,
            "cost": self.cost.summary(),
        }

    async def build_itinerary(
        self,
        trip_id: int,
        trip_name: str,
        trip_destination: str | None,
        day_plans: list[dict],
        existing_items: list[str],
        combined_content: str,
        profile: dict,
        source_urls: list[str] | None = None,
        places_mentioned: list[dict] | None = None,
        day_plans_from_links: list[dict] | None = None,
    ) -> dict:
        """
        Pro Phase 2: Build a unified itinerary from aggregated content + confirmed profile.

        Uses the agentic loop with validate_places + create_batch_itinerary_items tools.
        Content is already extracted — no fetch_url_content or transcribe_audio needed.
        """
        self.cost.link_id = 0  # Trip-wide, not per-link

        user_message = build_unified_prompt(
            trip_name=trip_name,
            trip_destination=trip_destination,
            day_plans=day_plans,
            existing_items=existing_items,
            combined_content=combined_content,
            profile=profile,
            source_urls=source_urls,
            trip_id=trip_id,
            places_mentioned=places_mentioned,
            day_plans_from_links=day_plans_from_links,
        )

        messages = [{"role": "user", "content": user_message}]

        # Context for auto-injection
        self._trip_id = trip_id
        self._link_id = 0
        self._day_plans = day_plans

        places_created = 0
        final_summary = ""

        system_blocks = [
            {
                "type": "text",
                "text": UNIFIED_SYSTEM_PROMPT,
                "cache_control": {"type": "ephemeral"},
            }
        ]

        for turn in range(self.max_turns):
            logger.info(
                "Agent build_itinerary turn %d/%d for trip %d", turn + 1, self.max_turns, trip_id
            )

            response = self.client.messages.create(
                model=self.model,
                max_tokens=8192,
                system=system_blocks,
                tools=PHASE2_TOOLS,
                messages=messages,
            )

            self.cost.record_usage(response.usage)

            usage = response.usage
            logger.info(
                "Turn %d tokens: %d in / %d out (cache read: %s, cache create: %s)",
                turn + 1,
                getattr(usage, "input_tokens", 0),
                getattr(usage, "output_tokens", 0),
                getattr(usage, "cache_read_input_tokens", "n/a"),
                getattr(usage, "cache_creation_input_tokens", "n/a"),
            )

            assistant_content = response.content
            messages.append({"role": "assistant", "content": assistant_content})

            if response.stop_reason == "end_turn":
                for block in assistant_content:
                    if hasattr(block, "text"):
                        final_summary = block.text
                logger.info("Agent build_itinerary finished for trip %d after %d turns", trip_id, turn + 1)
                break

            if response.stop_reason == "tool_use":
                tool_results = []

                for block in assistant_content:
                    if block.type != "tool_use":
                        continue

                    tool_name = block.name
                    tool_input = block.input
                    tool_use_id = block.id

                    logger.info(
                        "Tool call: %s(%s)",
                        tool_name,
                        _truncate(str(tool_input), 200),
                    )
                    self.cost.record_tool_call(tool_name)

                    self._fix_tool_input(tool_name, tool_input)
                    result_str = await self.handlers.dispatch(tool_name, tool_input)

                    if tool_name == "create_batch_itinerary_items":
                        try:
                            r = json.loads(result_str)
                            places_created += r.get("created", 0)
                        except Exception:
                            pass

                    tool_results.append(
                        {
                            "type": "tool_result",
                            "tool_use_id": tool_use_id,
                            "content": _trim_result(result_str),
                        }
                    )

                messages.append({"role": "user", "content": tool_results})
                _trim_messages(messages)

            else:
                logger.warning(
                    "Unexpected stop_reason '%s' for trip %d build_itinerary",
                    response.stop_reason, trip_id,
                )
                break
        else:
            logger.warning("Agent hit max turns (%d) for trip %d build_itinerary", self.max_turns, trip_id)
            final_summary = "Processing stopped: reached maximum number of steps."

        self.cost.log_summary()

        return {
            "places_created": places_created,
            "summary": final_summary,
            "cost": self.cost.summary(),
        }

    def _fix_tool_input(self, tool_name: str, tool_input: dict):
        """Auto-inject trip_id/link_id and map day numbers to day_plan_ids."""
        valid_dp_ids = [dp["id"] for dp in self._day_plans]
        dp_by_number = {dp["day_number"]: dp["id"] for dp in self._day_plans}

        if tool_name == "create_batch_itinerary_items":
            tool_input["trip_id"] = self._trip_id
            for item in tool_input.get("items", []):
                given = item.get("day_plan_id")
                if given not in valid_dp_ids and given in dp_by_number:
                    item["day_plan_id"] = dp_by_number[given]
                    logger.info("Mapped day %d → day_plan_id %d", given, item["day_plan_id"])
                elif given not in valid_dp_ids and valid_dp_ids:
                    item["day_plan_id"] = valid_dp_ids[0]
                    logger.warning("Invalid day_plan_id %s, defaulting to %d", given, valid_dp_ids[0])

        elif tool_name == "update_link_status":
            tool_input["trip_id"] = self._trip_id
            tool_input["link_id"] = self._link_id


def _truncate(s: str, max_len: int) -> str:
    return s[:max_len] + "..." if len(s) > max_len else s


def _trim_result(result_str: str, max_len: int = 2000) -> str:
    """Aggressively trim tool results to minimize context tokens."""
    if len(result_str) <= max_len:
        return result_str
    try:
        data = json.loads(result_str)

        # Trim transcripts
        if "transcript" in data and len(data.get("transcript", "")) > 1500:
            data["transcript"] = data["transcript"][:1500] + "...[trimmed]"

        # Trim content extraction results
        if "description" in data and len(data.get("description", "")) > 800:
            data["description"] = data["description"][:800] + "...[trimmed]"
        if "comments" in data:
            data["comments"] = data["comments"][:5]  # Keep only top 5
        if "captions" in data and isinstance(data["captions"], list):
            # Join captions into single string, trimmed
            text = " ".join(data["captions"])[:1000]
            data["captions"] = text

        # Trim validation results — keep only what's needed for item creation
        if "validated" in data:
            for v in data.get("validated", []):
                for key in ["operating_hours", "photos", "types", "google_maps_url",
                            "is_open_now", "reviews_count"]:
                    v.pop(key, None)

        # Trim batch create results
        if "item" in data:
            data.pop("item", None)  # Don't echo full item back

        trimmed = json.dumps(data)
        if len(trimmed) <= max_len:
            return trimmed
        return trimmed[:max_len] + '..."}'
    except Exception:
        return result_str[:max_len] + "...[trimmed]"


def _trim_messages(messages: list):
    """
    Trim older messages to reduce context size.
    Keep first user message + last 4 exchanges.
    """
    if len(messages) <= 7:  # first user + 3 exchanges (6 msgs) = 7
        return

    # Keep first message (user prompt) and last 6 messages (3 exchanges)
    first = messages[0]
    recent = messages[-6:]
    messages.clear()
    messages.append(first)
    messages.extend(recent)
    logger.info("Trimmed message history to %d messages", len(messages))
