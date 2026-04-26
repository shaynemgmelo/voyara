"""Meta-tests that pin the rails_contract constants to the actual Rails
source files. If a Rails dev adds a value to ItineraryItem::ORIGINS
without updating rails_contract, this test fails — preventing the silent
422s that bit trips 41 + 44.
"""
from __future__ import annotations
import re
from pathlib import Path

import pytest

pytestmark = pytest.mark.contracts

REPO_ROOT = Path(__file__).resolve().parents[2]

# Sanity check the path resolution — protects against future refactors
# of the test directory layout silently pointing _rails_constant at the
# wrong tree.
if not (REPO_ROOT / "backend").is_dir():
    pytest.fail(
        f"backend/ not found at expected REPO_ROOT={REPO_ROOT}. "
        "Update REPO_ROOT calculation in tests/test_rails_contract.py."
    )


def _rails_constant(model_path: str, name: str) -> set[str]:
    """Read `NAME = %w[a b c]` from a Rails model file. Anchored to
    start-of-line so a constant like `LEGACY_ORIGINS` doesn't match a
    query for `ORIGINS`."""
    text = (REPO_ROOT / model_path).read_text()
    match = re.search(rf"(?m)^\s*{name}\s*=\s*%w\[([^\]]+)\]", text)
    assert match, f"{name} not found in {model_path}"
    return set(match.group(1).split())


def _rails_permit_list(controller_path: str, model_key: str) -> set[str]:
    """Extract the field set from `params.require(:model_key).permit(...)`
    in a Rails controller. Captures BOTH bare symbols (`:foo`) and the
    keys of nested hash declarations (`operating_hours: {}, photos: []`).
    The permit list is exactly what controls which fields survive
    Strong Parameters before validation runs — drift between Python's
    mirror and this list is the bug class trip 41 + 44 hit.

    Comment-aware: Ruby comments are stripped first so a parenthesized
    aside like `# Phase 1 of the reform).` doesn't fool the regex into
    closing the permit() block early."""
    controller_path_full = REPO_ROOT / controller_path
    raw = controller_path_full.read_text()
    # Strip Ruby line comments (anything from `#` to end-of-line that
    # isn't inside a string literal). Good enough for permit blocks
    # which never contain string literals.
    text = re.sub(r"#[^\n]*", "", raw)
    # Match the permit block by requiring its closing `)` to sit at the
    # start of its own line (Ruby permit blocks always close that way).
    pattern = rf"params\.require\(:{model_key}\)\.permit\((.*?)^\s*\)"
    match = re.search(pattern, text, re.DOTALL | re.MULTILINE)
    assert match, (
        f"params.require(:{model_key}).permit(...) not found in {controller_path_full}"
    )
    block = match.group(1)
    fields: set[str] = set()
    # Bare symbols: :name, :description, ...
    for sym in re.findall(r":(\w+)", block):
        if sym != model_key:
            fields.add(sym)
    # Nested hash keys: operating_hours: {} OR photos: [] etc.
    for nested in re.findall(r"(\w+)\s*:\s*[\{\[]", block):
        fields.add(nested)
    return fields


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

    def test_itinerary_item_permitted_fields_match_rails(self):
        """The actual reason this whole module exists — if Rails
        adds/removes a permitted field on itinerary_items, the Python
        side must know. Without this test the permit-list mirror was
        a hand-maintained list with no drift detection, defeating the
        plan's purpose."""
        from app.services.rails_contract import ITINERARY_ITEM_PERMITTED_FIELDS
        rails = _rails_permit_list(
            "backend/app/controllers/api/v1/itinerary_items_controller.rb",
            "itinerary_item",
        )
        assert ITINERARY_ITEM_PERMITTED_FIELDS == rails, (
            f"Permit-list drift!\n"
            f"  In Python but not Rails: {sorted(ITINERARY_ITEM_PERMITTED_FIELDS - rails)}\n"
            f"  In Rails but not Python: {sorted(rails - ITINERARY_ITEM_PERMITTED_FIELDS)}"
        )


class TestAssertItineraryItemPayload:
    """Pin the behavior of the assertion helper — Task 3 will rely on
    these exact failure modes to surface payload-shape bugs as test
    failures instead of silent prod 422s."""

    def test_minimal_valid_payload_passes(self):
        from app.services.rails_contract import assert_itinerary_item_payload
        # Doesn't raise — that's the contract.
        assert_itinerary_item_payload({"name": "X"})

    def test_unknown_field_raises(self):
        from app.services.rails_contract import assert_itinerary_item_payload
        with pytest.raises(AssertionError, match="not in Rails permit list"):
            assert_itinerary_item_payload({"name": "X", "rating": 4.5})  # should be google_rating

    def test_invalid_category_raises(self):
        from app.services.rails_contract import assert_itinerary_item_payload
        with pytest.raises(AssertionError, match="category="):
            assert_itinerary_item_payload({"name": "X", "category": "place"})

    def test_invalid_origin_raises(self):
        from app.services.rails_contract import assert_itinerary_item_payload
        with pytest.raises(AssertionError, match="origin="):
            assert_itinerary_item_payload({"name": "X", "origin": "ai_assist_manual"})

    def test_non_dict_raises(self):
        from app.services.rails_contract import assert_itinerary_item_payload
        with pytest.raises(AssertionError, match="must be a dict"):
            assert_itinerary_item_payload(["not", "a", "dict"])  # type: ignore[arg-type]
