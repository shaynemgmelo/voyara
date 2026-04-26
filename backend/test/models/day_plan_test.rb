require "test_helper"

# Tests for the DayPlan model — primarily a regression catcher for the
# JSON-column deep-merge contract enforced by JsonColumnMerge in
# Api::V1::DayPlansController#update.
#
# The bug class this guards against: the frontend cached a stale
# pattern_signature snapshot (vibe + pace) and PATCHed only
# conflict_alerts back. Pre-fix Rails would replace the entire
# pattern_signature column with the absent value (nil/{}), wiping the
# trip's planning vibe data. The controller now deep-merges hash JSON
# columns; this test exercises the model API the controller calls.
class DayPlanTest < ActiveSupport::TestCase
  # Skip Rails' generator-default fixtures — same reason as TripTest:
  # they were never updated to match the current schema and would error
  # on load before our tests run.
  self.fixture_paths = []
  self.fixture_table_names = []
  self.use_transactional_tests = true

  def build_dp
    trip = Trip.create!(
      name: "T", destination: "X", num_days: 1,
      status: "active", ai_mode: "manual",
    )
    trip.day_plans.create!(day_number: 1)
  end

  test "JsonColumnMerge.merge_json_column preserves pattern_signature when only conflict_alerts updated" do
    dp = build_dp
    dp.update!(
      pattern_signature: { "vibe" => "cultural", "pace" => "moderate" },
      conflict_alerts: [{ "type" => "transit", "msg" => "long walk" }],
    )

    # Simulate the scenario where the AI service writes pattern_signature,
    # then the frontend PATCHes only conflict_alerts (no pattern_signature
    # key in the body). The controller's merge MUST preserve the existing
    # signature.
    incoming_pattern_signature = nil  # frontend didn't send it
    merged = JsonColumnMerge.merge_json_column(
      dp.pattern_signature, incoming_pattern_signature,
    )
    dp.update!(pattern_signature: merged, conflict_alerts: [])

    dp.reload
    assert_equal "cultural", dp.pattern_signature["vibe"]
    assert_equal "moderate", dp.pattern_signature["pace"]
    assert_equal [], dp.conflict_alerts
  end

  test "JsonColumnMerge.merge_json_column merges new pattern_signature keys without clobbering existing" do
    dp = build_dp
    dp.update!(pattern_signature: { "vibe" => "cultural", "pace" => "moderate" })

    # Frontend sends ONLY a new key (e.g. user toggles a UI control).
    incoming = { "energy" => "high" }
    merged = JsonColumnMerge.merge_json_column(dp.pattern_signature, incoming)
    dp.update!(pattern_signature: merged)

    dp.reload
    assert_equal "cultural", dp.pattern_signature["vibe"]      # preserved
    assert_equal "moderate", dp.pattern_signature["pace"]      # preserved
    assert_equal "high", dp.pattern_signature["energy"]        # added
  end
end
