# Tier-2 of the bug-proofing roadmap: DB-level invariants for fields
# that the app code already enforces. Catches the bug class where
# a code path bypasses the validator (e.g. raw SQL update,
# Rails console, future migration that wipes a default) and writes
# inconsistent data.
#
# Each constraint mirrors a `validates ... presence: true` or
# `validates ... numericality:` rule already in the model. The DB is
# the last line of defense.
class AddDataIntegrityConstraints < ActiveRecord::Migration[8.0]
  def change
    # ------------------------------------------------------------------
    # Trip — Trip#validates :name, presence: true
    #        Trip#validates :num_days, numericality:
    #          { greater_than: 0, less_than_or_equal_to: 30 }
    # status/ai_mode are already NOT NULL in schema (defaults set in
    # CreateTrips / AddAiModeToTrips), so these calls are no-ops we keep
    # for self-documentation and defense if a future migration drops the
    # NOT NULL.
    # ------------------------------------------------------------------
    change_column_null :trips, :name, false
    change_column_null :trips, :status, false
    change_column_null :trips, :ai_mode, false
    add_check_constraint :trips, "num_days BETWEEN 1 AND 30",
                         name: "trips_num_days_in_range"

    # ------------------------------------------------------------------
    # DayPlan — DayPlan#validates :day_number, presence: true,
    #             numericality: { greater_than: 0 }
    # trip_id is already NOT NULL per CreateDayPlans, kept here for the
    # same defense-in-depth reason as the Trip block above.
    # ------------------------------------------------------------------
    change_column_null :day_plans, :day_number, false
    add_check_constraint :day_plans, "day_number > 0",
                         name: "day_plans_day_number_positive"
    change_column_null :day_plans, :trip_id, false

    # ------------------------------------------------------------------
    # ItineraryItem — ItineraryItem#validates :name, presence: true
    # day_plan_id is already NOT NULL; kept for self-documentation.
    # ------------------------------------------------------------------
    change_column_null :itinerary_items, :name, false
    change_column_null :itinerary_items, :day_plan_id, false

    # ------------------------------------------------------------------
    # Link — Link#validates :url, presence: true
    # trip_id is already NOT NULL.
    # ------------------------------------------------------------------
    change_column_null :links, :url, false
    change_column_null :links, :trip_id, false

    # ------------------------------------------------------------------
    # Beyond-spec additions: model-level validators the spec missed.
    # Same Tier-2 reasoning — the model already enforces presence, so
    # the DB constraint is just the last line of defense.
    # ------------------------------------------------------------------

    # Lodging#validates :name, presence: true
    change_column_null :lodgings, :name, false

    # Flight#validates :airline, presence: true
    change_column_null :flights, :airline, false
  end
end
