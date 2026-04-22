class ItineraryItem < ApplicationRecord
  CATEGORY_OPTIONS    = %w[restaurant attraction hotel transport activity shopping cafe nightlife other].freeze
  ORIGINS             = %w[extracted_from_video ai_suggested user_added].freeze
  ITEM_STATUSES       = %w[fixed suggested editable].freeze
  BEST_TURNS          = %w[manha tarde noite flexivel].freeze
  EXTRACTION_METHODS  = %w[caption transcript on_screen_ocr manual].freeze
  # Camada 4 — planning model per item. Tells the UI (and future pipeline
  # passes) whether this card is a normal map pin or a full-day guided
  # tour that shouldn't be treated as a 90-minute attraction.
  ACTIVITY_MODELS = %w[
    direct_place
    anchored_experience
    guided_excursion
    route_cluster
    day_trip
    transfer
  ].freeze
  VISIT_MODES = %w[self_guided guided book_separately operator_based].freeze
  # STEP 2 of the travel-planning spec — semantic role layer, computed by
  # the orchestrator from category + activity_model + name heuristics.
  ITEM_ROLES = %w[
    landmark
    attraction
    neighborhood
    museum_cultural
    beach_island
    viewpoint_nature
    food_market
    nightlife_venue
    experience_activity
    transport_leg
    day_trip_destination
  ].freeze

  # Legacy mapping — the old `source` column is kept around for one release
  # so callers that haven't migrated yet still work.
  LEGACY_SOURCE_TO_ORIGIN = {
    "link" => "extracted_from_video",
    "ai"   => "ai_suggested",
  }.freeze
  LEGACY_ORIGIN_TO_SOURCE = LEGACY_SOURCE_TO_ORIGIN.invert.merge("user_added" => "ai").freeze

  belongs_to :day_plan
  has_one :trip, through: :day_plan

  validates :name, presence: true
  validates :category, inclusion: { in: CATEGORY_OPTIONS }, allow_nil: true
  validates :origin, inclusion: { in: ORIGINS }
  validates :item_status, inclusion: { in: ITEM_STATUSES }
  validates :best_turn, inclusion: { in: BEST_TURNS }, allow_nil: true
  validates :extraction_method, inclusion: { in: EXTRACTION_METHODS }, allow_nil: true
  # Camada 4 / STEP 2 — only validate when the column exists in the
  # current schema. Protects against migration skew (fresh deploy running
  # with an un-migrated db still serves 200s instead of 500-ing every
  # request that touches an ItineraryItem).
  if column_names.include?("activity_model")
    validates :activity_model, inclusion: { in: ACTIVITY_MODELS }, allow_nil: true
  end
  if column_names.include?("visit_mode")
    validates :visit_mode, inclusion: { in: VISIT_MODES }, allow_nil: true
  end
  if column_names.include?("item_role")
    validates :item_role, inclusion: { in: ITEM_ROLES }, allow_nil: true
  end

  before_validation :sync_legacy_source
  before_save       :backfill_best_turn

  # Public predicates used by the pipeline + frontend.
  def from_video?; origin == "extracted_from_video"; end
  def fixed?;      item_status == "fixed";           end

  private

  # If a caller still writes the old `source` string ("ai"/"link"), translate
  # it into the new `origin`. If `origin` is explicitly set, trust it and
  # update `source` to match so legacy consumers stay consistent.
  def sync_legacy_source
    if origin_changed? && origin.present?
      self.source = LEGACY_ORIGIN_TO_SOURCE.fetch(origin, "ai")
    elsif source_changed? && source.present? && LEGACY_SOURCE_TO_ORIGIN.key?(source)
      self.origin = LEGACY_SOURCE_TO_ORIGIN[source] if origin == "ai_suggested"
    end
  end

  # Derive `best_turn` from `time_slot` (HH:MM) when the caller didn't set it.
  # Mornings: 05:00–11:59, afternoons: 12:00–17:59, evenings: 18:00–23:59.
  def backfill_best_turn
    return if best_turn.present?
    return if time_slot.blank?
    hour = time_slot.to_s.split(":").first.to_i
    self.best_turn = case hour
                     when 5..11  then "manha"
                     when 12..17 then "tarde"
                     when 18..23 then "noite"
                     else "flexivel"
                     end
  end
end
