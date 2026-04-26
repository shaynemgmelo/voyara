/**
 * Pins the frontend-vs-backend ownership boundary for traveler_profile.
 * Trip 46 surfaced the bug class this module protects: the frontend
 * sent the WHOLE profile back via PATCH (including stale
 * places_mentioned) and clobbered backend enrichment. The fix is to
 * NEVER send backend-owned fields. This module is the single source
 * of truth for that whitelist.
 */
import {
  FRONTEND_OWNED_PROFILE_FIELDS,
  BACKEND_OWNED_PROFILE_FIELDS,
  stripBackendOwned,
} from "../profileFields";

describe("profileFields", () => {
  test("frontend and backend sets are disjoint", () => {
    const overlap = [...FRONTEND_OWNED_PROFILE_FIELDS].filter((f) =>
      BACKEND_OWNED_PROFILE_FIELDS.has(f),
    );
    expect(overlap).toEqual([]);
  });

  test("stripBackendOwned removes places_mentioned", () => {
    const profile = {
      travel_style: "x",
      places_mentioned: [{ name: "A" }],
      day_plans_from_links: [{ day: 1 }],
      external_research: "blob",
      destination_classification: { destination_type: "walkable_urban" },
      city_distribution: { status: "confirmed" },
    };
    const stripped = stripBackendOwned(profile);
    expect(stripped.travel_style).toBe("x");
    expect(stripped.places_mentioned).toBeUndefined();
    expect(stripped.day_plans_from_links).toBeUndefined();
    expect(stripped.external_research).toBeUndefined();
    expect(stripped.destination_classification).toBeUndefined();
    expect(stripped.city_distribution).toBeUndefined();
  });

  test("stripBackendOwned preserves all frontend-owned fields", () => {
    const profile = {
      travel_style: "a", travel_style_en: "b",
      interests: ["c"], interests_en: ["d"],
      pace: "moderado",
      country_detected: "France", cities_detected: ["Paris"],
      profile_description: "long text", profile_description_en: "en text",
      main_destination: { city: "Paris", country: "France" },
      needs_destination: false,
    };
    const stripped = stripBackendOwned(profile);
    for (const k of Object.keys(profile)) {
      expect(stripped[k]).toEqual(profile[k]);
    }
  });

  test("stripBackendOwned ignores unknown fields (defensive)", () => {
    const stripped = stripBackendOwned({
      travel_style: "x",
      __debug: true,
      arbitrary_extra: 42,
    });
    // Unknown fields fall through — the Rails permit list will reject
    // them harmlessly. We don't strip them here so test failures are
    // easier to debug (the test sees what was sent).
    expect(stripped.travel_style).toBe("x");
    expect(stripped.__debug).toBe(true);
  });
});
