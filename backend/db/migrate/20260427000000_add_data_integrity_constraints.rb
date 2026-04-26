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
    # Pre-flight: catch any violating rows BEFORE we acquire ACCESS
    # EXCLUSIVE locks. Fails fast with a clear "fix this row first"
    # message instead of leaving the schema half-applied on prod.
    check_data_integrity!

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

  private

  # Surface any constraint violations BEFORE the change block grabs
  # ACCESS EXCLUSIVE locks on the tables. On prod, a single bad row
  # otherwise causes the migration to die mid-way through with the
  # schema half-applied — exactly what we don't want during a Render
  # deploy.
  def check_data_integrity!
    bad_trips = ActiveRecord::Base.connection.select_value(<<~SQL)
      SELECT count(*) FROM trips
      WHERE name IS NULL
         OR status IS NULL
         OR ai_mode IS NULL
         OR num_days IS NULL
         OR num_days < 1
         OR num_days > 30
    SQL
    if bad_trips.to_i > 0
      raise "#{bad_trips} trip rows violate the new constraints. Run a data migration first."
    end

    bad_day_plans = ActiveRecord::Base.connection.select_value(<<~SQL)
      SELECT count(*) FROM day_plans
      WHERE day_number IS NULL OR day_number < 1 OR trip_id IS NULL
    SQL
    if bad_day_plans.to_i > 0
      raise "#{bad_day_plans} day_plan rows violate the new constraints. Fix them first."
    end

    bad_items = ActiveRecord::Base.connection.select_value(<<~SQL)
      SELECT count(*) FROM itinerary_items
      WHERE name IS NULL OR day_plan_id IS NULL
    SQL
    if bad_items.to_i > 0
      raise "#{bad_items} itinerary_item rows violate the new constraints. Fix them first."
    end

    bad_links = ActiveRecord::Base.connection.select_value(<<~SQL)
      SELECT count(*) FROM links
      WHERE url IS NULL OR trip_id IS NULL
    SQL
    if bad_links.to_i > 0
      raise "#{bad_links} link rows violate the new constraints. Fix them first."
    end

    bad_lodgings = ActiveRecord::Base.connection.select_value(<<~SQL)
      SELECT count(*) FROM lodgings
      WHERE name IS NULL
    SQL
    if bad_lodgings.to_i > 0
      raise "#{bad_lodgings} lodging rows violate the new constraints. Fix them first."
    end

    bad_flights = ActiveRecord::Base.connection.select_value(<<~SQL)
      SELECT count(*) FROM flights
      WHERE airline IS NULL
    SQL
    if bad_flights.to_i > 0
      raise "#{bad_flights} flight rows violate the new constraints. Fix them first."
    end
  end
end
