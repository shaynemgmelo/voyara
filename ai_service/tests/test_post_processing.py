"""Invariant tests for the post-Sonnet pipeline helpers.

Each test crafts a small place_list (just dicts, no DB / LLM / network)
and asserts the helper's output matches the documented behavior. These
exist specifically because every helper here has been the source of
at least one user-reported regression in the last week:

  - _enforce_day_trip_isolation deleted 12 video items on day 1 of
    trip 27 ("porque mudou o dia 1 todo????"). Now: video items are
    sacred — never dropped here.
  - _split_multi_day_trip_days didn't exist; trip 31 ended up with
    Campanópolis + Parque de la Costa on the same day ("porque ficou
    essa bagunça?"). Now: 2nd day-trip moves to a flex day.
  - _ensure_link_places_present injected day-trip-named items onto
    days that already had a day-trip (root cause of the trip 31 mess).
  - _tighten_day_clusters dropped Versailles (17km from Paris) before
    we taught it to skip day-trip days.
  - _optimize_day_proximity swapped urban items into the Versailles
    day before we taught it the same.

If a regression sneaks back in, one of these will fail before it
reaches the user.
"""
from __future__ import annotations

import pytest

from app.services.orchestrator import (
    _enforce_day_trip_isolation,
    _ensure_link_places_present,
    _optimize_day_proximity,
    _split_multi_day_trip_days,
    _tighten_day_clusters,
)


# ---------------------------------------------------------------------------
# Test data builders — keep them tiny so tests read at a glance
# ---------------------------------------------------------------------------

PARIS_LATLNG = (48.8566, 2.3522)
VERSAILLES_LATLNG = (48.8049, 2.1204)
TIGRE_LATLNG = (-34.4263, -58.5797)
BUENOS_AIRES_LATLNG = (-34.6037, -58.3816)
CAMPANOPOLIS_LATLNG = (-34.7887, -58.6064)


def _item(
    name: str,
    day: int,
    *,
    lat: float | None = None,
    lng: float | None = None,
    address: str = "",
    city: str = "",
    activity_model: str | None = None,
    item_role: str | None = None,
    duration_minutes: int = 90,
    source: str = "ai",
    origin: str | None = None,
) -> dict:
    """Build a minimal item dict matching the shape orchestrator helpers expect."""
    out = {
        "name": name,
        "day": day,
        "duration_minutes": duration_minutes,
        "source": source,
    }
    if lat is not None:
        out["latitude"] = lat
    if lng is not None:
        out["longitude"] = lng
    if address:
        out["address"] = address
    if city:
        out["city"] = city
    if activity_model:
        out["activity_model"] = activity_model
    if item_role:
        out["item_role"] = item_role
    if origin:
        out["origin"] = origin
    return out


def _versailles_dt(day: int) -> dict:
    """The canonical day-trip item we test against."""
    return _item(
        "Palace of Versailles",
        day,
        lat=VERSAILLES_LATLNG[0],
        lng=VERSAILLES_LATLNG[1],
        address="Place d'Armes, 78000 Versailles, France",
        city="Paris",  # propagated from base — this is the case that broke before
        activity_model="day_trip",
        item_role="day_trip_destination",
        duration_minutes=480,
    )


def _paris_item(name: str, day: int) -> dict:
    return _item(
        name,
        day,
        lat=PARIS_LATLNG[0],
        lng=PARIS_LATLNG[1],
        address=f"{name}, 75001 Paris, France",
        city="Paris",
    )


# ---------------------------------------------------------------------------
# _enforce_day_trip_isolation
# ---------------------------------------------------------------------------

class TestEnforceDayTripIsolation:
    def test_no_day_trip_no_op(self):
        """Day without any day-trip item is left unchanged."""
        items = [_paris_item("Louvre", 1), _paris_item("Tuileries", 1)]
        result = _enforce_day_trip_isolation(list(items))
        assert len(result) == 2

    def test_drops_other_city_items_on_day_trip_day(self):
        """Versailles day-trip + Paris items → Paris items dropped."""
        items = [
            _versailles_dt(day=4),
            _paris_item("Louvre", 4),
            _paris_item("Tuileries", 4),
        ]
        result = _enforce_day_trip_isolation(items)
        names = {i["name"] for i in result}
        assert "Palace of Versailles" in names
        assert "Louvre" not in names
        assert "Tuileries" not in names

    def test_keeps_same_city_items_on_day_trip_day(self):
        """Versailles day-trip + Hall of Mirrors (also in Versailles) → both kept."""
        hall_of_mirrors = _item(
            "Hall of Mirrors",
            4,
            lat=VERSAILLES_LATLNG[0],
            lng=VERSAILLES_LATLNG[1],
            address="Place d'Armes, 78000 Versailles, France",
            city="Paris",  # again, propagated — the bug case
        )
        items = [_versailles_dt(day=4), hall_of_mirrors]
        result = _enforce_day_trip_isolation(items)
        names = {i["name"] for i in result}
        assert names == {"Palace of Versailles", "Hall of Mirrors"}

    def test_dt_city_parsed_from_address_not_item_city(self):
        """Regression for trip 28: item.city='Paris' would have falsely matched
        every Paris item. Address parse must take precedence."""
        items = [
            _versailles_dt(day=4),
            # This Paris item has city='Paris' which equals Versailles' city
            # field (both propagated). If we used item.city, this would
            # falsely "match" and stay. Address parse must drop it.
            _paris_item("Rodin Museum", 4),
        ]
        result = _enforce_day_trip_isolation(items)
        names = {i["name"] for i in result}
        assert "Rodin Museum" not in names

    def test_handles_long_duration_as_day_trip(self):
        """duration_minutes >= 300 implicitly marks a day-trip day."""
        long_excursion = _item(
            "All-day boat tour",
            5,
            lat=TIGRE_LATLNG[0],
            lng=TIGRE_LATLNG[1],
            address="Lavalle 520, 1648 Tigre, Argentina",
            duration_minutes=360,
        )
        urban = _item(
            "Cafe in Palermo",
            5,
            lat=BUENOS_AIRES_LATLNG[0],
            lng=BUENOS_AIRES_LATLNG[1],
            address="Honduras 5500, Buenos Aires, Argentina",
        )
        result = _enforce_day_trip_isolation([long_excursion, urban])
        names = {i["name"] for i in result}
        assert "All-day boat tour" in names
        assert "Cafe in Palermo" not in names


# ---------------------------------------------------------------------------
# _split_multi_day_trip_days
# ---------------------------------------------------------------------------

class TestSplitMultiDayTripDays:
    def test_splits_two_day_trips_in_different_cities(self):
        """The trip 31 case — Campanópolis + Parque de la Costa on day 4."""
        campanopolis = _item(
            "Campanópolis",
            4,
            lat=CAMPANOPOLIS_LATLNG[0],
            lng=CAMPANOPOLIS_LATLNG[1],
            address="Bariloche 7300, González Catán, Argentina",
            activity_model="day_trip",
            item_role="day_trip_destination",
            duration_minutes=300,
        )
        parque_costa = _item(
            "Parque de la Costa",
            4,
            lat=TIGRE_LATLNG[0],
            lng=TIGRE_LATLNG[1],
            address="Vivanco 1509, Tigre, Argentina",
            activity_model="day_trip",
            item_role="day_trip_destination",
            duration_minutes=300,
        )
        # Day 5 is flex and empty — should be the move target.
        empty_flex_day = _paris_item("placeholder for empty day", 5)
        items = [campanopolis, parque_costa, empty_flex_day]
        # Make day 5 actually empty for the split to use it.
        items.remove(empty_flex_day)
        # Inject one item on day 5 with no day-trip so split sees it as a
        # candidate target.
        urban_filler = _item("BA cafe", 5, lat=BUENOS_AIRES_LATLNG[0], lng=BUENOS_AIRES_LATLNG[1])
        items.append(urban_filler)

        result = _split_multi_day_trip_days(items)
        # One of the two day-trips should have moved off day 4.
        day4_dts = [
            i for i in result
            if i.get("day") == 4
            and (i.get("activity_model") == "day_trip"
                 or i.get("item_role") == "day_trip_destination")
        ]
        assert len(day4_dts) == 1, f"Expected 1 day-trip on day 4 after split, got {len(day4_dts)}"

    def test_keeps_two_items_when_same_destination(self):
        """Versailles palace + Versailles gardens on day 4 → both stay."""
        palace = _versailles_dt(day=4)
        gardens = _item(
            "Gardens of Versailles",
            4,
            lat=VERSAILLES_LATLNG[0],
            lng=VERSAILLES_LATLNG[1],
            address="78000 Versailles, France",
            activity_model="day_trip",
            item_role="day_trip_destination",
        )
        result = _split_multi_day_trip_days([palace, gardens])
        days = [i["day"] for i in result]
        assert days == [4, 4]

    def test_no_split_for_single_day_trip(self):
        """One day-trip on the day → no-op."""
        items = [_versailles_dt(day=4), _paris_item("Louvre", 1)]
        result = _split_multi_day_trip_days(list(items))
        # Order and content unchanged.
        assert {i["name"] for i in result} == {"Palace of Versailles", "Louvre"}

    def test_skips_locked_days(self):
        """A day_rigidity='locked' day is never modified — even if it has 2 day-trips."""
        items = [
            _item("DT-A", 1, address="A, 12345 CityA, Country",
                  activity_model="day_trip", duration_minutes=300),
            _item("DT-B", 1, address="B, 12345 CityB, Country",
                  activity_model="day_trip", duration_minutes=300),
        ]
        result = _split_multi_day_trip_days(items, day_rigidity={1: "locked"})
        assert all(i["day"] == 1 for i in result)


# ---------------------------------------------------------------------------
# _ensure_link_places_present
# ---------------------------------------------------------------------------

class TestEnsureLinkPlacesPresent:
    def test_avoids_day_with_existing_day_trip_for_dt_named_item(self):
        """Trip 31 regression: Parque de la Costa (link mention) must NOT
        be injected on day 4 if Campanópolis is already there."""
        place_list = [
            _item(
                "Campanópolis",
                4,
                activity_model="day_trip",
                item_role="day_trip_destination",
                duration_minutes=300,
                source="ai",
            ),
            _paris_item("Random urban thing", 1),  # day 1 has 1 item
        ]
        places_mentioned = [
            {"name": "Parque de la Costa", "source_url": "https://x.com/v"},
        ]
        # 5 day plans — days 1, 2, 3, 4, 5
        day_plans = [{"day_number": d, "id": d * 10} for d in range(1, 6)]
        result = _ensure_link_places_present(
            place_list, places_mentioned, day_plans,
        )
        injected = [i for i in result if i.get("name") == "Parque de la Costa"]
        assert len(injected) == 1
        # Must NOT be on day 4 (which has Campanópolis day-trip).
        assert injected[0]["day"] != 4

    def test_normal_item_uses_least_packed_day(self):
        """A regular link mention (not day-trip-shaped) just goes to the
        least-packed day."""
        place_list = [
            _paris_item("A", 1),
            _paris_item("B", 1),
            _paris_item("C", 1),
            _paris_item("D", 2),
        ]
        places_mentioned = [
            {"name": "Café Tortoni", "source_url": "https://x.com/v"},
        ]
        day_plans = [{"day_number": d, "id": d * 10} for d in range(1, 4)]
        result = _ensure_link_places_present(
            place_list, places_mentioned, day_plans,
        )
        injected = [i for i in result if i.get("name") == "Café Tortoni"]
        assert len(injected) == 1
        # Day 3 is empty → least-packed, should land there.
        assert injected[0]["day"] == 3


# ---------------------------------------------------------------------------
# _tighten_day_clusters
# ---------------------------------------------------------------------------

class TestTightenDayClusters:
    def test_skips_day_with_day_trip(self):
        """Versailles is 17km from Paris centroid — must NOT be moved by
        the cluster tightener. _enforce_day_trip_isolation owns these days."""
        items = [
            _versailles_dt(day=4),
            _item(
                "Versailles secondary",
                4,
                lat=VERSAILLES_LATLNG[0] + 0.02,
                lng=VERSAILLES_LATLNG[1] + 0.02,
                address="Versailles area",
            ),
            # And a Paris filler on day 1 so there's a candidate target day.
            _paris_item("filler", 1),
        ]
        result = _tighten_day_clusters(list(items), max_diameter_km=7.0)
        # Both Versailles items must remain on day 4.
        v_items = [i for i in result if "Versailles" in i["name"]]
        assert all(i["day"] == 4 for i in v_items)

    def test_tightens_loose_urban_day(self):
        """Day with items >7km apart should have outliers moved or dropped."""
        items = [
            _paris_item("A", 1),
            _paris_item("B", 1),
            _item(
                "FarOutlier",
                1,
                # ~25km off Paris centroid
                lat=PARIS_LATLNG[0] + 0.25,
                lng=PARIS_LATLNG[1] + 0.25,
                address="far away",
            ),
        ]
        result = _tighten_day_clusters(list(items), max_diameter_km=7.0)
        # The far outlier must either be moved off day 1 OR dropped.
        day1 = [i for i in result if i.get("day") == 1]
        outlier_on_day1 = any(i.get("name") == "FarOutlier" for i in day1)
        assert not outlier_on_day1

    def test_locked_day_within_loose_threshold_untouched(self):
        """A locked day with 8km diameter (e.g. Microcentro+Recoleta) stays
        intact — looser locked threshold (12km default) honors video intent."""
        items = [
            _paris_item("A", 1),
            _paris_item("B", 1),
            _item(
                "ModerateOutlier",
                1,
                # ~8km from Paris centroid
                lat=PARIS_LATLNG[0] + 0.08,
                lng=PARIS_LATLNG[1] + 0.05,
                address="suburb",
                source="link",
            ),
        ]
        result = _tighten_day_clusters(
            list(items), day_rigidity={1: "locked"},
        )
        day1_names = [i.get("name") for i in result if i.get("day") == 1]
        assert "ModerateOutlier" in day1_names

    def test_locked_day_egregious_diameter_gets_outlier_flagged(self):
        """A locked day with 25km diameter (egregious — Microcentro+Tigre on
        the same day) crosses the 12km locked threshold and the link-sourced
        outlier gets flagged for user review."""
        items = [
            _paris_item("A", 1),
            _paris_item("B", 1),
            _paris_item("C", 1),
            _item(
                "TigreFarAway",
                1,
                lat=PARIS_LATLNG[0] + 0.25,  # ~25km
                lng=PARIS_LATLNG[1] + 0.25,
                address="far suburb",
                source="link",
            ),
        ]
        result = _tighten_day_clusters(
            list(items), day_rigidity={1: "locked"},
        )
        outliers = [i for i in result if i.get("name") == "TigreFarAway"]
        assert len(outliers) == 1
        # Either moved off day 1 OR flagged for review (link-sourced never dropped).
        moved_off = outliers[0].get("day") != 1
        flagged = bool(outliers[0].get("needs_review"))
        assert moved_off or flagged


# ---------------------------------------------------------------------------
# _optimize_day_proximity
# ---------------------------------------------------------------------------

class TestOptimizeDayProximity:
    def test_does_not_pull_urban_into_day_trip_day(self):
        """A Paris item that's an outlier on day 5 must NOT be swapped
        into day 4 (which is the Versailles day-trip day)."""
        items = [
            _versailles_dt(day=4),
            _paris_item("Eiffel Tower", 5),
            _item(
                "Outlier near Versailles",
                5,
                lat=VERSAILLES_LATLNG[0] + 0.01,
                lng=VERSAILLES_LATLNG[1] + 0.01,
                address="near Versailles",
            ),
        ]
        result = _optimize_day_proximity(list(items))
        # The "Outlier near Versailles" geographically belongs near day 4,
        # but day 4 is a day-trip day. Optimizer must leave the outlier on
        # day 5 rather than contaminate day 4.
        day4_names = {i["name"] for i in result if i["day"] == 4}
        assert "Outlier near Versailles" not in day4_names

    def test_within_day_reorder_preserves_day_assignment(self):
        """Within-day reordering must never change item.day."""
        items = [
            _paris_item("A", 1),
            _paris_item("B", 1),
            _paris_item("C", 1),
        ]
        result = _optimize_day_proximity(list(items))
        assert all(i["day"] == 1 for i in result)
