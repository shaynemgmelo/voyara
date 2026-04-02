class AddNumDaysToTrips < ActiveRecord::Migration[8.1]
  def change
    add_column :trips, :num_days, :integer, default: 5, null: false
  end
end
