class AddGeoFieldsToLodgings < ActiveRecord::Migration[8.1]
  def change
    add_column :lodgings, :latitude, :decimal, precision: 10, scale: 7
    add_column :lodgings, :longitude, :decimal, precision: 10, scale: 7
    add_column :lodgings, :google_place_id, :string
    add_column :lodgings, :google_rating, :decimal, precision: 2, scale: 1
  end
end
