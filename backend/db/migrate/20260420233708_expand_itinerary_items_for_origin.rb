class ExpandItineraryItemsForOrigin < ActiveRecord::Migration[8.0]
  # Replaces the binary `source` column ("ai"|"link") with a richer three-state
  # `origin` ("extracted_from_video"|"ai_suggested"|"user_added") plus extra
  # provenance + editability metadata needed by the new product rules.
  #
  # The existing `source` and `source_url` columns stay for one release so the
  # frontend + ai_service can keep reading them while the new code path is
  # rolled out. A follow-up migration removes them once the old code is gone.
  #
  # Data migration mapping:
  #   "ai"   -> origin: "ai_suggested"
  #   "link" -> origin: "extracted_from_video"
  #   other  -> origin: "ai_suggested"  (safety default)
  def up
    change_table :itinerary_items, bulk: true do |t|
      t.string  :origin,                default: "ai_suggested", null: false
      t.string  :source_video_url
      t.string  :source_video_creator
      t.string  :extraction_method
      t.integer :priority,              default: 0,            null: false
      t.string  :item_status,           default: "suggested",  null: false
      t.string  :best_turn
      t.string  :region
    end

    # Backfill origin from legacy source
    execute <<~SQL.squish
      UPDATE itinerary_items
      SET origin = CASE
        WHEN source = 'link' THEN 'extracted_from_video'
        WHEN source = 'ai'   THEN 'ai_suggested'
        ELSE 'ai_suggested'
      END
    SQL

    # Backfill source_video_url from the (now ambiguously named) source_url
    execute <<~SQL.squish
      UPDATE itinerary_items
      SET source_video_url = source_url
      WHERE source = 'link' AND source_url IS NOT NULL
    SQL

    add_index :itinerary_items, :origin
    add_index :itinerary_items, :item_status
  end

  def down
    remove_index :itinerary_items, :origin
    remove_index :itinerary_items, :item_status
    change_table :itinerary_items, bulk: true do |t|
      t.remove :origin
      t.remove :source_video_url
      t.remove :source_video_creator
      t.remove :extraction_method
      t.remove :priority
      t.remove :item_status
      t.remove :best_turn
      t.remove :region
    end
  end
end
