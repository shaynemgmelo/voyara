class AddCityToDayPlans < ActiveRecord::Migration[8.0]
  def change
    add_column :day_plans, :city, :string
    add_index :day_plans, [:trip_id, :city]
  end
end
