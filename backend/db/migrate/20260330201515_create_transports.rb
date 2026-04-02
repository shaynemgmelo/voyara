class CreateTransports < ActiveRecord::Migration[8.1]
  def change
    create_table :transports do |t|
      t.string :transport_type
      t.string :company
      t.string :confirmation_number
      t.string :total_cost
      t.datetime :departure_date
      t.datetime :arrival_date
      t.string :pickup_location
      t.string :dropoff_location
      t.string :vehicle_info
      t.text :notes
      t.boolean :booked
      t.references :trip, null: false, foreign_key: true

      t.timestamps
    end
  end
end
