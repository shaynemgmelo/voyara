"""Meta-tests that pin the rails_contract constants to the actual Rails
source files. If a Rails dev adds a value to ItineraryItem::ORIGINS
without updating rails_contract, this test fails — preventing the silent
422s that bit trips 41 + 44.
"""
from __future__ import annotations
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


def _rails_constant(model_path: str, name: str) -> set[str]:
    """Read `NAME = %w[a b c]` from a Rails model file."""
    text = (REPO_ROOT / model_path).read_text()
    match = re.search(rf"{name}\s*=\s*%w\[([^\]]+)\]", text)
    assert match, f"{name} not found in {model_path}"
    return set(match.group(1).split())


class TestRailsContractInSync:
    def test_itinerary_item_categories_match_rails(self):
        from app.services.rails_contract import ITINERARY_ITEM_CATEGORIES
        rails = _rails_constant(
            "backend/app/models/itinerary_item.rb", "CATEGORY_OPTIONS"
        )
        assert ITINERARY_ITEM_CATEGORIES == rails

    def test_itinerary_item_origins_match_rails(self):
        from app.services.rails_contract import ITINERARY_ITEM_ORIGINS
        rails = _rails_constant(
            "backend/app/models/itinerary_item.rb", "ORIGINS"
        )
        assert ITINERARY_ITEM_ORIGINS == rails

    def test_day_plan_origins_match_rails(self):
        from app.services.rails_contract import DAY_PLAN_ORIGINS
        rails = _rails_constant("backend/app/models/day_plan.rb", "ORIGINS")
        assert DAY_PLAN_ORIGINS == rails
