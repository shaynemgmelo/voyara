require "test_helper"

# Tests for ItineraryItem — primarily a regression catcher for the
# JSON-column deep-merge contract enforced by JsonColumnMerge in
# Api::V1::ItineraryItemsController#update.
#
# itinerary_items#update is the HIGHEST-risk endpoint per the audit:
# the swap path's buildItineraryItemPayload emits
# `operating_hours: place.operating_hours ?? {}` — when the new place
# has no hours data, the empty hash would have replaced the existing
# weekly schedule. The controller now deep-merges; these tests pin
# that contract.
class ItineraryItemTest < ActiveSupport::TestCase
  # Skip Rails' generator-default fixtures — same reason as TripTest /
  # DayPlanTest: they were never updated to match the current schema and
  # would error on load before our tests run.
  self.fixture_paths = []
  self.fixture_table_names = []
  self.use_transactional_tests = true

  def build_item
    trip = Trip.create!(
      name: "T", destination: "X", num_days: 1,
      status: "active", ai_mode: "manual",
    )
    dp = trip.day_plans.create!(day_number: 1)
    dp.itinerary_items.create!(name: "Café", category: "restaurant")
  end

  test "JsonColumnMerge preserves operating_hours when swap-path PATCH sends empty hash" do
    item = build_item
    item.update!(operating_hours: {
      "monday" => "9-22",
      "tuesday" => "9-22",
      "wednesday" => "9-22",
    })

    # Simulate swap-path payload: buildItineraryItemPayload emits
    # `operating_hours: place.operating_hours ?? {}` — when the new
    # place has no hours data, we'd send {}.
    incoming = {}
    merged = JsonColumnMerge.merge_json_column(item.operating_hours, incoming)
    item.update!(operating_hours: merged)

    item.reload
    assert_equal "9-22", item.operating_hours["monday"], "Monday hours preserved"
    assert_equal "9-22", item.operating_hours["tuesday"], "Tuesday hours preserved"
    assert_equal "9-22", item.operating_hours["wednesday"], "Wednesday hours preserved"
  end

  test "JsonColumnMerge merges new operating_hours keys without dropping existing" do
    item = build_item
    item.update!(operating_hours: { "monday" => "9-22" })

    # Backend enrichment adds Tuesday-Sunday data while the user is
    # holding a stale snapshot.
    incoming = { "tuesday" => "10-23" }
    merged = JsonColumnMerge.merge_json_column(item.operating_hours, incoming)
    item.update!(operating_hours: merged)

    item.reload
    assert_equal "9-22", item.operating_hours["monday"]   # preserved
    assert_equal "10-23", item.operating_hours["tuesday"] # added
  end
end
