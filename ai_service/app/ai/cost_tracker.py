"""
Token usage and cost tracking for Claude API calls.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

# Pricing per million tokens (Claude Sonnet 4)
INPUT_COST_PER_M = 3.00       # $3.00 per 1M input tokens
OUTPUT_COST_PER_M = 15.00     # $15.00 per 1M output tokens
CACHE_READ_COST_PER_M = 0.30  # $0.30 per 1M cached read tokens
CACHE_WRITE_COST_PER_M = 3.75 # $3.75 per 1M cache creation tokens


@dataclass
class CostTracker:
    """Track token usage and estimated costs for a processing session."""

    link_id: int | None = None
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_creation_tokens: int = 0
    api_calls: int = 0
    tool_calls: int = 0
    _tool_call_log: list[str] = field(default_factory=list)

    def record_usage(self, usage):
        """Record token usage from an API response."""
        if not usage:
            return
        self.input_tokens += getattr(usage, "input_tokens", 0) or 0
        self.output_tokens += getattr(usage, "output_tokens", 0) or 0
        self.cache_read_tokens += getattr(usage, "cache_read_input_tokens", 0) or 0
        self.cache_creation_tokens += getattr(usage, "cache_creation_input_tokens", 0) or 0
        self.api_calls += 1

    def record_tool_call(self, tool_name: str):
        """Record a tool call."""
        self.tool_calls += 1
        self._tool_call_log.append(tool_name)

    @property
    def total_cost(self) -> float:
        cost = (self.input_tokens / 1_000_000) * INPUT_COST_PER_M
        cost += (self.output_tokens / 1_000_000) * OUTPUT_COST_PER_M
        cost += (self.cache_read_tokens / 1_000_000) * CACHE_READ_COST_PER_M
        cost += (self.cache_creation_tokens / 1_000_000) * CACHE_WRITE_COST_PER_M
        return cost

    def summary(self) -> dict:
        """Return a summary dict."""
        return {
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "cache_read_tokens": self.cache_read_tokens,
            "cache_creation_tokens": self.cache_creation_tokens,
            "total_tokens": self.input_tokens + self.output_tokens,
            "api_calls": self.api_calls,
            "tool_calls": self.tool_calls,
            "tool_call_log": self._tool_call_log,
            "estimated_cost_usd": round(self.total_cost, 4),
        }

    def log_summary(self):
        """Log a summary of usage."""
        s = self.summary()
        logger.info(
            "💰 Cost for link %s: %d input + %d output + %d cache_read + %d cache_write tokens, "
            "%d API calls, %d tool calls, ~$%.4f",
            self.link_id,
            s["input_tokens"],
            s["output_tokens"],
            s["cache_read_tokens"],
            s["cache_creation_tokens"],
            s["api_calls"],
            s["tool_calls"],
            s["estimated_cost_usd"],
        )
