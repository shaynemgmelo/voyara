"""Meta-tests that pin the rails_contract constants to the actual Rails
source files. If a Rails dev adds a value to ItineraryItem::ORIGINS
without updating rails_contract, this test fails — preventing the silent
422s that bit trips 41 + 44.
"""
from __future__ import annotations
import re
import textwrap
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


def _rails_permit_list(controller_path: str, model_key: str, match_index: int = 0) -> set[str]:
    """Extract the field set from the Nth `params.require(:model_key).permit(...)`
    block in a Rails controller. Default match_index=0 grabs the first
    block; pass 1 for the second (e.g. links_controller has TWO permit
    blocks: link_params and link_update_params).

    Captures BOTH bare symbols (`:foo`) and the keys of nested hash
    declarations (`operating_hours: {}, photos: []`). The permit list is
    exactly what controls which fields survive Strong Parameters before
    validation runs — drift between Python's mirror and this list is the
    bug class trip 41 + 44 hit.

    Comment-aware: Ruby comments are stripped first so a parenthesized
    aside like `# Phase 1 of the reform).` doesn't fool the regex into
    closing the permit() block early.

    Block-end is detected by paren-balance scan from the opening `(`,
    so both single-line (`permit(:url)`) and multi-line permit blocks
    work. Strong-params array-of-hashes shapes (`conflict_alerts:
    [[:type, :day, ...]]`) are stripped before symbol extraction so the
    inner shape symbols don't pollute the top-level field set."""
    controller_path_full = REPO_ROOT / controller_path
    raw = controller_path_full.read_text()
    # Strip Ruby line comments (anything from `#` to end-of-line that
    # isn't inside a string literal). Good enough for permit blocks
    # which never contain string literals.
    text = re.sub(r"#[^\n]*", "", raw)
    header = rf"params\.require\(:{model_key}\)\.permit\("
    matches: list[str] = []
    for header_match in re.finditer(header, text):
        # Paren-balance scan from the opening `(` so we tolerate both
        # single-line `permit(:url)` and multi-line permit blocks. The
        # earlier `^\s*\)` end-anchor only matched multi-line, missing
        # `params.require(:trip).permit(:name, ...)` and
        # `params.require(:link).permit(:url)` outright.
        start = header_match.end()
        depth = 1
        i = start
        while i < len(text) and depth > 0:
            ch = text[i]
            if ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
            i += 1
        if depth == 0:
            matches.append(text[start:i - 1])
    assert match_index < len(matches), (
        f"only {len(matches)} permit() block(s) found for :{model_key} in {controller_path_full}; "
        f"requested index {match_index}"
    )
    block = matches[match_index]
    # Strip array-of-hashes shape declarations like
    # `conflict_alerts: [[:type, :day, :message]]`. The inner symbols
    # describe the SHAPE of each array element (not standalone permitted
    # fields), so they must not feed the bare-symbol scan below. The key
    # itself (`conflict_alerts`) is still picked up by the nested-hash
    # regex — `[[` matches `[\{\[]` — so dropping the inner content is
    # safe.
    block_no_array_shapes = re.sub(r"\[\[.*?\]\]", "[[]]", block, flags=re.DOTALL)
    fields: set[str] = set()
    # Bare symbols: :name, :description, ...
    for sym in re.findall(r":(\w+)", block_no_array_shapes):
        if sym != model_key:
            fields.add(sym)
    # Nested hash keys: operating_hours: {} OR photos: [] etc.
    for nested in re.findall(r"(\w+)\s*:\s*[\{\[]", block_no_array_shapes):
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

    def test_trip_permitted_fields_match_rails(self):
        from app.services.rails_contract import TRIP_PERMITTED_FIELDS
        rails = _rails_permit_list(
            "backend/app/controllers/api/v1/trips_controller.rb", "trip",
        )
        assert TRIP_PERMITTED_FIELDS == rails, (
            f"Trip permit-list drift!\n"
            f"  Python only: {sorted(TRIP_PERMITTED_FIELDS - rails)}\n"
            f"  Rails only: {sorted(rails - TRIP_PERMITTED_FIELDS)}"
        )

    def test_day_plan_permitted_fields_match_rails(self):
        from app.services.rails_contract import DAY_PLAN_PERMITTED_FIELDS
        rails = _rails_permit_list(
            "backend/app/controllers/api/v1/day_plans_controller.rb", "day_plan",
        )
        assert DAY_PLAN_PERMITTED_FIELDS == rails, (
            f"DayPlan permit-list drift!\n"
            f"  Python only: {sorted(DAY_PLAN_PERMITTED_FIELDS - rails)}\n"
            f"  Rails only: {sorted(rails - DAY_PLAN_PERMITTED_FIELDS)}"
        )

    def test_link_update_permitted_fields_match_rails(self):
        from app.services.rails_contract import LINK_UPDATE_PERMITTED_FIELDS
        # links_controller.rb has TWO permit lists. We mirror the UPDATE one
        # (link_update_params) since that's what the AI service uses.
        rails = _rails_permit_list(
            "backend/app/controllers/api/v1/links_controller.rb", "link",
            match_index=1,  # the SECOND permit() block — link_update_params
        )
        assert LINK_UPDATE_PERMITTED_FIELDS == rails, (
            f"Link update permit-list drift!\n"
            f"  Python only: {sorted(LINK_UPDATE_PERMITTED_FIELDS - rails)}\n"
            f"  Rails only: {sorted(rails - LINK_UPDATE_PERMITTED_FIELDS)}"
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


class TestRailsPermitParser:
    """Direct unit tests for _rails_permit_list. Pin parser behavior
    independent of which Rails files happen to exercise which syntax."""

    def _write_controller(self, tmp_path, body: str) -> str:
        """Write a fake controller file under a backend/ subtree so the
        parser's REPO_ROOT-relative path lookups still work."""
        ctrl = tmp_path / "backend" / "app" / "controllers" / "api" / "v1"
        ctrl.mkdir(parents=True)
        f = ctrl / "fake_controller.rb"
        f.write_text(body)
        return str(f.relative_to(tmp_path))

    def test_single_line_permit(self, tmp_path, monkeypatch):
        from app.services import rails_contract as _  # ensure module loaded
        from tests import test_rails_contract as t
        monkeypatch.setattr(t, "REPO_ROOT", tmp_path)

        body = textwrap.dedent('''
            class FakeController
              def fake_params
                params.require(:fake).permit(:foo, :bar, :baz)
              end
            end
        ''').strip()
        path = self._write_controller(tmp_path, body)
        result = t._rails_permit_list(path, "fake")
        assert result == {"foo", "bar", "baz"}

    def test_multi_line_permit(self, tmp_path, monkeypatch):
        from tests import test_rails_contract as t
        monkeypatch.setattr(t, "REPO_ROOT", tmp_path)

        body = textwrap.dedent('''
            class FakeController
              def fake_params
                params.require(:fake).permit(
                  :foo,
                  :bar,
                  :baz,
                )
              end
            end
        ''').strip()
        path = self._write_controller(tmp_path, body)
        result = t._rails_permit_list(path, "fake")
        assert result == {"foo", "bar", "baz"}

    def test_array_of_hashes_strips_inner_symbols(self, tmp_path, monkeypatch):
        from tests import test_rails_contract as t
        monkeypatch.setattr(t, "REPO_ROOT", tmp_path)

        body = textwrap.dedent('''
            class FakeController
              def fake_params
                params.require(:fake).permit(
                  :name,
                  alerts: [[:type, :message, :severity]],
                )
              end
            end
        ''').strip()
        path = self._write_controller(tmp_path, body)
        result = t._rails_permit_list(path, "fake")
        # Outer key (alerts) included; inner symbols (type/message/severity) excluded.
        assert result == {"name", "alerts"}, (
            f"Inner [[]] symbols leaked or outer key dropped: {result}"
        )

    def test_nested_hash_columns_extracted(self, tmp_path, monkeypatch):
        from tests import test_rails_contract as t
        monkeypatch.setattr(t, "REPO_ROOT", tmp_path)

        body = textwrap.dedent('''
            class FakeController
              def fake_params
                params.require(:fake).permit(:foo, traveler_profile: {})
              end
            end
        ''').strip()
        path = self._write_controller(tmp_path, body)
        result = t._rails_permit_list(path, "fake")
        assert result == {"foo", "traveler_profile"}

    def test_match_index_picks_correct_block(self, tmp_path, monkeypatch):
        from tests import test_rails_contract as t
        monkeypatch.setattr(t, "REPO_ROOT", tmp_path)

        body = textwrap.dedent('''
            class FakeController
              def first_params
                params.require(:fake).permit(:url)
              end

              def second_params
                params.require(:fake).permit(:status, extracted_data: {})
              end
            end
        ''').strip()
        path = self._write_controller(tmp_path, body)
        first = t._rails_permit_list(path, "fake", match_index=0)
        second = t._rails_permit_list(path, "fake", match_index=1)
        assert first == {"url"}
        assert second == {"status", "extracted_data"}

    def test_inline_comments_dont_break_parser(self, tmp_path, monkeypatch):
        from tests import test_rails_contract as t
        monkeypatch.setattr(t, "REPO_ROOT", tmp_path)

        body = textwrap.dedent('''
            class FakeController
              def fake_params
                params.require(:fake).permit(
                  :foo,         # the foo
                  :bar,         # the bar (Phase 1).
                  :baz,
                )
              end
            end
        ''').strip()
        path = self._write_controller(tmp_path, body)
        result = t._rails_permit_list(path, "fake")
        assert result == {"foo", "bar", "baz"}, (
            f"Comments leaked into field set: {result}"
        )

    def test_missing_permit_block_raises(self, tmp_path, monkeypatch):
        from tests import test_rails_contract as t
        monkeypatch.setattr(t, "REPO_ROOT", tmp_path)

        body = textwrap.dedent('''
            class FakeController
              # No permit block at all
            end
        ''').strip()
        path = self._write_controller(tmp_path, body)
        with pytest.raises(AssertionError, match="permit"):
            t._rails_permit_list(path, "fake")

    def test_match_index_out_of_range_raises(self, tmp_path, monkeypatch):
        from tests import test_rails_contract as t
        monkeypatch.setattr(t, "REPO_ROOT", tmp_path)

        body = textwrap.dedent('''
            class FakeController
              def fake_params
                params.require(:fake).permit(:foo)
              end
            end
        ''').strip()
        path = self._write_controller(tmp_path, body)
        with pytest.raises(AssertionError, match="requested index"):
            t._rails_permit_list(path, "fake", match_index=5)


class TestFrontendBackendProfileFieldsParity:
    """Both the Rails ProfileFieldGuard and frontend profileFields.js
    list the same set of "backend-owned" profile keys. Drift between
    them re-introduces the trip 46 bug class — frontend strips one set,
    Rails accepts another, gap = clobber. This test catches drift."""

    def test_backend_owned_sets_match(self):
        # Read the Rails concern.
        rails_path = REPO_ROOT / "backend/app/controllers/concerns/profile_field_guard.rb"
        rails_text = rails_path.read_text()
        rails_match = re.search(
            r"BACKEND_OWNED_PROFILE_FIELDS\s*=\s*%w\[([^\]]+)\]", rails_text,
        )
        assert rails_match, "BACKEND_OWNED_PROFILE_FIELDS not found in Rails concern"
        rails_fields = set(rails_match.group(1).split())

        # Read the JS module.
        js_path = REPO_ROOT / "frontend/src/utils/profileFields.js"
        js_text = js_path.read_text()
        js_match = re.search(
            r"BACKEND_OWNED_PROFILE_FIELDS\s*=\s*new\s+Set\(\[([^\]]+)\]",
            js_text, re.DOTALL,
        )
        assert js_match, "BACKEND_OWNED_PROFILE_FIELDS not found in JS module"
        # The JS list contains "string", "literals". Extract them.
        js_fields = set(re.findall(r'"([^"]+)"', js_match.group(1)))

        assert rails_fields == js_fields, (
            f"Backend-owned profile field drift!\n"
            f"  Rails only: {sorted(rails_fields - js_fields)}\n"
            f"  JS only: {sorted(js_fields - rails_fields)}"
        )
