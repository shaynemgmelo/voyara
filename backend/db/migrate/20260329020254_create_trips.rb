class CreateTrips < ActiveRecord::Migration[8.1]
  def change
    create_table :trips do |t|
      t.string :name
      t.string :destination
      t.date :start_date
      t.date :end_date
      t.string :status, default: "draft", null: false

      t.timestamps
    end

    add_index :trips, :status
  end
end
