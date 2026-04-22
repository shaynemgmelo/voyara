class AddItemRoleToItineraryItems < ActiveRecord::Migration[8.0]
  def change
    # STEP 2 of the travel-planning spec — semantic role layer. Complements
    # category + activity_model with a finer-grained classification
    # (landmark, museum_cultural, beach_island, nightlife_venue, etc.)
    # computed by the orchestrator from existing fields + name heuristics.
    # UI uses it for icons and filters.
    add_column :itinerary_items, :item_role, :string
    add_index  :itinerary_items, :item_role
  end
end
