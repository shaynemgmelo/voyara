class CreateFlights < ActiveRecord::Migration[8.0]
  def change
    create_table :flights do |t|
      t.string :airline
      t.string :flight_number
      t.string :confirmation_number
      t.string :total_cost
      t.datetime :departure_date
      t.datetime :arrival_date
      t.string :departure_airport
      t.string :arrival_airport
      t.string :seats
      t.text :notes
      t.boolean :booked
      t.references :trip, null: false, foreign_key: true

      t.timestamps
    end
  end
end
