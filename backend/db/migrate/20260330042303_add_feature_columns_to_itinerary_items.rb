class AddFeatureColumnsToItineraryItems < ActiveRecord::Migration[8.0]
  def change
    add_column :itinerary_items, :personal_notes, :text
    add_column :itinerary_items, :vibe_tags, :jsonb, default: []
    add_column :itinerary_items, :alerts, :jsonb, default: []
    add_column :itinerary_items, :alternative_group, :string

    add_index :itinerary_items, :vibe_tags, using: :gin
    add_index :itinerary_items, :alternative_group
  end
end
