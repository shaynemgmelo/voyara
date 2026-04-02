class CreateDayPlans < ActiveRecord::Migration[8.1]
  def change
    create_table :day_plans do |t|
      t.references :trip, null: false, foreign_key: true
      t.integer :day_number
      t.date :date
      t.text :notes

      t.timestamps
    end

    add_index :day_plans, [:trip_id, :day_number], unique: true
  end
end
