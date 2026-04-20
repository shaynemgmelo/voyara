class ExpandDayPlansForRigidity < ActiveRecord::Migration[8.0]
  # Adds the structural metadata needed to implement Regra #0 (preserve video
  # day structure) and Regra #1 (main city first) at the data layer.
  #
  # Origin  = who created the day (video vs AI vs user)
  # Rigidity = how much downstream processing is allowed to touch it
  # DayType  = whether this is an urban day, a day trip, or a transfer day
  #
  # All defaults match today's behaviour so existing rows stay valid.
  def change
    change_table :day_plans, bulk: true do |t|
      t.string :origin,       default: "ai_created", null: false
      t.string :rigidity,     default: "flexible",   null: false
      t.string :day_type,     default: "urban",      null: false
      t.string :primary_region
      t.string :source_video_url
      t.string :source_creator_handle
      t.string :estimated_pace
      t.jsonb  :pattern_signature, default: {}, null: false
      t.jsonb  :conflict_alerts,   default: [], null: false
    end

    add_index :day_plans, :rigidity
    add_index :day_plans, :day_type
    add_index :day_plans, :origin
  end
end
