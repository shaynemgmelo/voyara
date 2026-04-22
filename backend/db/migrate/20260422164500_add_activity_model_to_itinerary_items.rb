class AddActivityModelToItineraryItems < ActiveRecord::Migration[8.0]
  def change
    # Camada 4 of the supplementary destination-aware planning spec.
    # An itinerary item is no longer just "a place pin" — it can be a
    # guided tour, a day trip, a transfer day, or a regional circuit.
    # These fields let the UI render the card differently and let the
    # AI generator emit honest structures for tour-driven destinations.
    add_column :itinerary_items, :activity_model, :string
    # Enum values:
    #   direct_place        — a walkable pin (restaurant, museum, viewpoint)
    #   anchored_experience — experience with a clear map anchor (Maya Bay)
    #   guided_excursion    — operator-led full-day tour (boat tour, safari)
    #   route_cluster       — grouped regional circuit (east-side Atacama)
    #   day_trip            — full-day trip to a secondary destination
    #   transfer            — travel day between base cities
    add_column :itinerary_items, :visit_mode, :string
    # Enum values: self_guided | guided | book_separately | operator_based

    add_index :itinerary_items, :activity_model
  end
end
