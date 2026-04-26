/**
 * Pins the canonical builder against the Rails permit list. Trip 44
 * surfaced this as a real bug: handleDragEnd in TripDetail.js sent
 * only {name, category, source, origin, source_url} — losing every
 * geo field the place was carrying. The new card landed with no
 * coords and the map pin silently disappeared. This test makes
 * sure the canonical builder propagates everything Rails will accept.
 */
import { buildItineraryItemPayload, RAILS_PERMITTED_FIELDS, RAILS_VALID_CATEGORIES } from "../itineraryItemPayload";

describe("buildItineraryItemPayload", () => {
  test("propagates every geo field from the place", () => {
    const place = {
      name: "Caminito",
      category: "attraction",
      source_url: "https://x",
      latitude: -34.6,
      longitude: -58.37,
      address: "Caminito, BA",
      google_place_id: "ChIJ...",
      rating: 4.5,
      reviews_count: 5681,
      photo_url: "https://photo/1.jpg",
      photos: ["https://photo/1.jpg", "https://photo/2.jpg"],
      phone: "+54 11 ...",
      website: "https://caminito.example",
      operating_hours: { Monday: "9-5" },
      pricing: "$$",
    };
    const payload = buildItineraryItemPayload(place, { dayPlanId: 1 });
    expect(payload.latitude).toBe(-34.6);
    expect(payload.longitude).toBe(-58.37);
    expect(payload.google_place_id).toBe("ChIJ...");
    expect(payload.google_rating).toBe(4.5);
    expect(payload.google_reviews_count).toBe(5681);
    expect(payload.address).toBe("Caminito, BA");
    expect(payload.photos).toEqual(["https://photo/1.jpg", "https://photo/2.jpg"]);
    expect(payload.operating_hours).toEqual({ Monday: "9-5" });
    expect(payload.pricing_info).toBe("$$");
  });

  test("normalizes invalid category to attraction", () => {
    for (const bad of ["place", "", null, undefined, "unknown"]) {
      const payload = buildItineraryItemPayload({ name: "X", category: bad });
      expect(RAILS_VALID_CATEGORIES.has(payload.category)).toBe(true);
    }
  });

  test("never emits fields outside the Rails permit list", () => {
    const place = {
      name: "X",
      category: "attraction",
      // junk fields that shouldn't appear in the payload
      __debug: true,
      internal_id: 999,
      poolIndex: 5,
      community_notes: [{ note: "x" }],
      editorial_summary: "x",
      top_reviews: [{}],
      creator_note: "x",
      rich_description: "x",
      practical_tips: ["x"],
      kind: "place",
    };
    const payload = buildItineraryItemPayload(place);
    const extra = Object.keys(payload).filter((k) => !RAILS_PERMITTED_FIELDS.has(k));
    expect(extra).toEqual([]);
  });

  test("maps rating → google_rating, reviews_count → google_reviews_count", () => {
    const payload = buildItineraryItemPayload({
      name: "X", category: "attraction", rating: 4.7, reviews_count: 100,
    });
    expect(payload.rating).toBeUndefined();
    expect(payload.reviews_count).toBeUndefined();
    expect(payload.google_rating).toBe(4.7);
    expect(payload.google_reviews_count).toBe(100);
  });

  test("default origin is extracted_from_video", () => {
    const payload = buildItineraryItemPayload({ name: "X", category: "attraction" });
    expect(payload.origin).toBe("extracted_from_video");
  });

  test("origin can be overridden", () => {
    const payload = buildItineraryItemPayload(
      { name: "X", category: "attraction" },
      { origin: "ai_suggested" },
    );
    expect(payload.origin).toBe("ai_suggested");
  });

  test("warns in dev when overrides contain unknown fields", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    buildItineraryItemPayload(
      { name: "X" },
      { unknown_field: 42, also_bogus: true },
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("itineraryItemPayload"),
      expect.arrayContaining(["unknown_field", "also_bogus"]),
    );
    warn.mockRestore();
  });
});
