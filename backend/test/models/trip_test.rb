require "test_helper"

# Tests for the Trip model — focus is on the num_days↔day_plans
# synchronization that lets the user adjust trip duration from the
# trip-detail page after creation.
#
# The two requirements that drove this code:
#   1. Growing num_days must add empty day_plans at the end (not
#      renumber existing ones).
#   2. Shrinking num_days must REFUSE if any of the chopped days
#      still has itinerary_items — the user has to clear them first
#      so we never silently destroy their work.
class TripTest < ActiveSupport::TestCase
  # Skip Rails' generator-default fixtures — they were never updated to
  # match the current schema (e.g. latitude=9.99 overflows the column),
  # so loading them via `fixtures :all` in test_helper would error
  # before our tests run. We don't need them: each test builds the
  # specific Trip + DayPlans it cares about.
  self.fixture_paths = []
  self.fixture_table_names = []
  self.use_transactional_tests = true

  def build_trip(num_days:, name: "Test Trip")
    trip = Trip.create!(
      name: name,
      destination: "Buenos Aires",
      num_days: num_days,
      status: "active",
      ai_mode: "manual",
    )
    # Mirror what TripsController#generate_day_plans does on create.
    num_days.times { |i| trip.day_plans.create!(day_number: i + 1) }
    trip
  end

  test "growing num_days appends empty day_plans at the end" do
    trip = build_trip(num_days: 3)
    assert_equal 3, trip.day_plans.count

    trip.update!(num_days: 5)
    trip.reload

    assert_equal 5, trip.day_plans.count
    nums = trip.day_plans.pluck(:day_number).sort
    assert_equal [1, 2, 3, 4, 5], nums
    # New days should be marked user_edited so downstream code can tell
    # them apart from days extracted from a video.
    new_days = trip.day_plans.where(day_number: [4, 5])
    assert new_days.all? { |d| d.origin == "user_edited" }
  end

  test "shrinking num_days drops trailing empty day_plans" do
    trip = build_trip(num_days: 5)
    trip.update!(num_days: 3)
    trip.reload

    assert_equal 3, trip.day_plans.count
    nums = trip.day_plans.pluck(:day_number).sort
    assert_equal [1, 2, 3], nums
  end

  test "shrinking refuses if a chopped day has itinerary_items" do
    trip = build_trip(num_days: 5)
    # Park an item on day 4 — that day would be chopped if we shrink to 3.
    day4 = trip.day_plans.find_by(day_number: 4)
    day4.itinerary_items.create!(name: "Caminito", category: "attraction")

    trip.num_days = 3
    refute trip.valid?, "Trip should refuse to shrink while day 4 has items"
    err = trip.errors[:num_days].join
    assert_match /day 4/i, err
    assert_match /still have items/i, err

    # Original day count should be intact after the failed update.
    assert_equal 5, trip.day_plans.count
  end

  test "shrinking succeeds once the user clears the chopped day" do
    trip = build_trip(num_days: 5)
    day4 = trip.day_plans.find_by(day_number: 4)
    item = day4.itinerary_items.create!(name: "Caminito", category: "attraction")

    # First attempt fails (covered above).
    trip.num_days = 3
    refute trip.valid?

    # Clear the offending item, then retry.
    item.destroy
    trip.reload
    trip.update!(num_days: 3)
    assert_equal 3, trip.reload.day_plans.count
  end

  test "renaming the trip leaves day_plans untouched" do
    trip = build_trip(num_days: 4)
    original_ids = trip.day_plans.pluck(:id).sort

    trip.update!(name: "Renamed Adventure")
    assert_equal "Renamed Adventure", trip.reload.name
    assert_equal original_ids, trip.day_plans.pluck(:id).sort
  end

  test "no-op num_days update doesn't recreate day_plans" do
    trip = build_trip(num_days: 4)
    original_ids = trip.day_plans.pluck(:id).sort

    # Same value — Rails dirty tracking shouldn't fire saved_change_to_num_days?
    trip.update!(num_days: 4)
    assert_equal original_ids, trip.reload.day_plans.pluck(:id).sort
  end

  test "num_days validations block <1 and >30" do
    trip = build_trip(num_days: 5)

    trip.num_days = 0
    refute trip.valid?
    assert_match /greater than 0/i, trip.errors[:num_days].join

    trip.num_days = 31
    refute trip.valid?
    assert_match /less than or equal to 30/i, trip.errors[:num_days].join
  end
end
