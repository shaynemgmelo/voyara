class CreateItineraryItems < ActiveRecord::Migration[8.1]
  def change
    create_table :itinerary_items do |t|
      t.references :day_plan, null: false, foreign_key: true
      t.string :name
      t.text :description
      t.string :category
      t.string :time_slot
      t.integer :duration_minutes
      t.integer :position, default: 0, null: false
      t.decimal :latitude, precision: 10, scale: 7
      t.decimal :longitude, precision: 10, scale: 7
      t.string :address
      t.string :google_place_id
      t.decimal :google_rating, precision: 2, scale: 1
      t.integer :google_reviews_count
      t.jsonb :operating_hours, default: {}
      t.string :pricing_info
      t.string :phone
      t.string :website
      t.jsonb :photos, default: []
      t.text :notes
      t.string :source_url

      t.timestamps
    end

    add_index :itinerary_items, [:day_plan_id, :position]
    add_index :itinerary_items, :google_place_id
  end
end
