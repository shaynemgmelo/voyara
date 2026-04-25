"""Smoke test for the extract-and-build pipeline.

Creates a fresh staging trip per canonical scenario, runs the FULL real
pipeline (Tavily + Sonnet + Google Places), and asserts cross-cutting
invariants on the result. Each run hits paid APIs — don't run on every
commit. Cost ~$1-3, time ~3-6 min for the full set.

Pre-reqs:
  - Rails API running on localhost:3000 (or RAILS_API_URL).
  - AI service running on localhost:8000.
  - SERVICE_API_KEY, ANTHROPIC_API_KEY, TAVILY_API_KEY, GOOGLE_PLACES_API_KEY
    set in ai_service/.env.
  - scripts/smoke_scenarios.json filled in with REAL video links.

Usage (from ai_service/):
  python -m scripts.smoke_canonical                     # all scenarios
  python -m scripts.smoke_canonical buenos_aires_5d     # one scenario
  python -m scripts.smoke_canonical --keep              # keep trips on success

Exit code: 0 if every scenario passes invariants, 1 otherwise.

Trips are created with is_staging=true so they're flagged in the UI and
filterable. On success they're deleted; on failure they're kept so the
output is inspectable.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from pathlib import Path

import httpx

from app.config import settings
from app.services.orchestrator import _assert_pipeline_invariants

SCRIPT_DIR = Path(__file__).parent
SCENARIOS_FILE = SCRIPT_DIR / "smoke_scenarios.json"
AI_SERVICE_URL = "http://localhost:8000"
POLL_INTERVAL_S = 5
# 6 min covers the worst case (15-day multi_base build with the new dynamic
# budget in routes.py: 180 + 20*15 = 480s, capped at 500s upstream).
BUDGET_S = 540


def _service_headers() -> dict[str, str]:
    return {
        "Content-Type": "application/json",
        "X-Service-Key": getattr(settings, "service_api_key", "") or "",
    }


def _err(name: str, msg: str, *, trip_id: int | None = None) -> dict:
    return {
        "name": name,
        "ok": False,
        "error": msg,
        "trip_id": trip_id,
        "violations": [],
        "warnings": [],
        "duration_s": 0,
        "items": 0,
    }


async def _wait_for_build(
    http: httpx.AsyncClient, rails_url: str, trip_id: int, started: float, name: str,
) -> dict | None:
    """Poll until the build completes, returning the final trip dict —
    or an error dict if it timed out / failed. Auto-confirms multi_base
    pause with the proportional default so the test exercises the full
    pipeline."""
    last_stage = None
    while True:
        await asyncio.sleep(POLL_INTERVAL_S)
        elapsed = time.time() - started
        if elapsed > BUDGET_S:
            return _err(name, f"timed out after {int(elapsed)}s", trip_id=trip_id)

        try:
            bs = (await http.get(f"{AI_SERVICE_URL}/build-status/{trip_id}")).json()
        except Exception as e:
            print(f"    {int(elapsed)}s: build-status check failed ({e}) — retrying")
            continue

        if bs.get("active"):
            stage = bs.get("stage")
            if stage and stage != last_stage:
                last_stage = stage
                print(f"    {int(elapsed)}s: {stage}")
            continue

        # Build is no longer active. Three outcomes:
        #   1. Real items landed → done.
        #   2. build_error persisted → failure.
        #   3. multi_base pause → auto-confirm and keep polling.
        trip = (await http.get(f"{rails_url}/trips/{trip_id}")).json()
        items_count = int(trip.get("items_count") or 0)
        profile = trip.get("traveler_profile") or {}

        if items_count > 0:
            return trip

        be = profile.get("build_error")
        if be:
            return _err(
                name,
                f"build_error: {be.get('message') if isinstance(be, dict) else be}",
                trip_id=trip_id,
            )

        cd = profile.get("city_distribution") or {}
        if cd.get("status") == "awaiting":
            print(
                f"    {int(elapsed)}s: paused for multi_base "
                f"({len(cd.get('selected_cities') or [])} cities) — "
                "auto-confirming proportional distribution"
            )
            confirm = await http.post(
                f"{AI_SERVICE_URL}/confirm-city-distribution",
                json={
                    "trip_id": trip_id,
                    "selected_cities": cd.get("selected_cities") or [],
                    "day_distribution": cd.get("day_distribution") or {},
                },
            )
            if confirm.status_code >= 400:
                return _err(
                    name,
                    f"confirm-city-distribution failed: "
                    f"{confirm.status_code} {confirm.text[:200]}",
                    trip_id=trip_id,
                )
            continue

        # No items, no error, no pause — short wait, re-check.
        continue


async def run_scenario(scenario: dict, *, keep_trip: bool) -> dict:
    name = scenario["name"]
    num_days = int(scenario["num_days"])
    links = [u for u in (scenario.get("links") or []) if u]
    print(f"\n→ {name} ({num_days}d, {len(links)} links)")

    if not links:
        return _err(
            name,
            "no links in scenario — fill in scripts/smoke_scenarios.json before running",
        )

    started = time.time()
    rails_url = settings.rails_api_url

    async with httpx.AsyncClient(timeout=30.0, headers=_service_headers()) as http:
        # 1. Create trip via Rails.
        create_payload = {
            "trip": {
                "name": f"[smoke] {name}",
                "num_days": num_days,
                "destination": scenario["destination"],
                "ai_mode": "eco",
                "is_staging": True,
                "traveler_profile": scenario.get("traveler_profile") or {},
            }
        }
        resp = await http.post(f"{rails_url}/trips", json=create_payload)
        if resp.status_code >= 400:
            return _err(name, f"trip create: {resp.status_code} {resp.text[:200]}")
        trip_id = int(resp.json().get("id"))
        print(f"  trip_id={trip_id}")

        # 2. Trigger combined extract-and-build via Rails (which proxies to
        #    AI service). Mirrors the real frontend flow.
        build_resp = await http.post(
            f"{rails_url}/trips/{trip_id}/build",
            json={"links": links},
        )
        if build_resp.status_code >= 400:
            return _err(
                name,
                f"build trigger: {build_resp.status_code} {build_resp.text[:200]}",
                trip_id=trip_id,
            )
        print(f"  build triggered, polling…")

        # 3. Wait until build completes (or fails / times out).
        outcome = await _wait_for_build(http, rails_url, trip_id, started, name)
        if outcome is None or outcome.get("ok") is False:
            return outcome  # type: ignore[return-value]
        trip = outcome

        # 4. Run invariants on the final trip state.
        place_list: list[dict] = []
        for dp in trip.get("day_plans", []):
            day = dp.get("day_number")
            for it in (dp.get("itinerary_items") or []):
                place_list.append({**it, "day": day})

        profile = trip.get("traveler_profile") or {}
        result = _assert_pipeline_invariants(
            place_list,
            places_mentioned=profile.get("places_mentioned") or [],
            num_days=num_days,
            strict=False,
            context=f"smoke:{name}",
        )

        ok = not result["violations"]
        if ok and not keep_trip:
            await http.delete(f"{rails_url}/trips/{trip_id}")
            print(f"  ✓ deleted staging trip {trip_id}")
        else:
            print(f"  → keeping trip {trip_id} (open in UI to inspect)")

        return {
            "name": name,
            "ok": ok,
            "duration_s": round(time.time() - started, 1),
            "items": len(place_list),
            "violations": result["violations"],
            "warnings": result["warnings"],
            "trip_id": trip_id,
        }


async def _run_all(scenarios: list[dict], *, keep_trip: bool) -> list[dict]:
    out = []
    for s in scenarios:
        out.append(await run_scenario(s, keep_trip=keep_trip))
    return out


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Smoke test the extract-and-build pipeline against canonical trips.",
    )
    ap.add_argument(
        "scenario", nargs="?",
        help="Run a single scenario by name (default: all in smoke_scenarios.json)",
    )
    ap.add_argument(
        "--keep", action="store_true",
        help="Don't delete staging trips on success (useful when debugging)",
    )
    args = ap.parse_args()

    if not SCENARIOS_FILE.exists():
        print(f"Missing {SCENARIOS_FILE}", file=sys.stderr)
        sys.exit(2)

    scenarios = json.loads(SCENARIOS_FILE.read_text())
    if args.scenario:
        scenarios = [s for s in scenarios if s.get("name") == args.scenario]
        if not scenarios:
            print(f"No scenario named {args.scenario!r}", file=sys.stderr)
            sys.exit(2)

    results = asyncio.run(_run_all(scenarios, keep_trip=args.keep))

    print("\n" + "=" * 60)
    passed = sum(1 for r in results if r["ok"])
    print(f"{'PASS' if passed == len(results) else 'FAIL'}: {passed}/{len(results)} scenarios")
    for r in results:
        emoji = "✓" if r["ok"] else "✗"
        print(f"  {emoji} {r['name']} ({r.get('duration_s', '?')}s, {r.get('items', 0)} items)")
        for v in r.get("violations", []) or []:
            print(f"      VIOLATION: {v}")
        for w in r.get("warnings", []) or []:
            print(f"      WARN: {w}")
        if r.get("error"):
            print(f"      ERROR: {r['error']}")
        if r.get("trip_id"):
            print(f"      trip_id={r['trip_id']}")

    sys.exit(0 if passed == len(results) else 1)


if __name__ == "__main__":
    main()
