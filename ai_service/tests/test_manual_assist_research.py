"""Tests for the research-augmented manual_assist flow.

Covers the three new helpers added to orchestrator.py:
  - _research_day_by_day_itinerary  (Tavily + Haiku)
  - _detect_outlier_days            (geographic outlier detection)
  - (geocode helper covered indirectly via _detect_outlier_days +
    end-to-end manual_assist_research tests in test_manual_assist.py)

These tests are deterministic — Tavily/Haiku/Google calls are either
mocked or guarded by the fail-open path, so the real network is never
touched (conftest.py blocks live connections anyway).
"""
from __future__ import annotations

from unittest.mock import patch

import pytest

from app.services.orchestrator import (
    _detect_outlier_days,
    _research_day_by_day_itinerary,
)


def test_detect_outlier_days_flags_far_day():
    """A day with a place 60km from cluster centroid is an outlier."""
    items_by_day = {
        1: [{"name": "Campanópolis", "latitude": -34.78, "longitude": -58.60}],
        2: [{"name": "Recoleta", "latitude": -34.59, "longitude": -58.39}],
        3: [{"name": "Palermo", "latitude": -34.58, "longitude": -58.42}],
        4: [{"name": "San Telmo", "latitude": -34.62, "longitude": -58.37}],
    }
    outliers = _detect_outlier_days(items_by_day, threshold_km=20.0)
    assert 1 in outliers, "Day 1 (Campanópolis) should be flagged"
    assert 2 not in outliers
    assert 3 not in outliers
    assert 4 not in outliers


def test_detect_outlier_days_handles_missing_geo():
    """Days with no geo on any item are skipped (not flagged)."""
    items_by_day = {
        1: [{"name": "X"}],  # no geo
        2: [{"name": "Y", "latitude": -34.59, "longitude": -58.39}],
    }
    outliers = _detect_outlier_days(items_by_day, threshold_km=20.0)
    # Day 1 has no geo to compute → not flagged. Day 2 is alone → with
    # only one populated centroid the function returns an empty set
    # (no cluster reference to be away from).
    assert outliers == set()


def test_detect_outlier_days_empty():
    assert _detect_outlier_days({}, threshold_km=20.0) == set()


@pytest.mark.asyncio
async def test_research_returns_empty_on_no_tavily_key():
    """If TAVILY_API_KEY not set, returns empty list (fails open)."""
    from app.config import settings
    with patch.object(settings, "tavily_api_key", ""):
        result = await _research_day_by_day_itinerary(
            "France", ["Paris"], 5, "art lover",
        )
        assert result == []
