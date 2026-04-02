class AddSourceToItineraryItems < ActiveRecord::Migration[8.1]
  def change
    add_column :itinerary_items, :source, :string, default: "ai"
  end
end
