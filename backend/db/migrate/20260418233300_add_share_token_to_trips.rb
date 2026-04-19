class AddShareTokenToTrips < ActiveRecord::Migration[8.0]
  def change
    add_column :trips, :share_token, :string
    add_column :trips, :shared_at, :datetime
    add_index :trips, :share_token, unique: true
  end
end
