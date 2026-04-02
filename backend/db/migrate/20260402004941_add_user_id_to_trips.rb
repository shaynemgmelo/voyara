class AddUserIdToTrips < ActiveRecord::Migration[8.1]
  def change
    # Supabase Auth user UUID — string format (not integer FK)
    add_column :trips, :user_id, :string
    add_index :trips, :user_id
  end
end
