class AddNumDaysToTrips < ActiveRecord::Migration[8.0]
  def change
    add_column :trips, :num_days, :integer, default: 5, null: false
  end
end
