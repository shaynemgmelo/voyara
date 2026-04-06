class AddTravelerProfileToTrips < ActiveRecord::Migration[8.0]
  def change
    add_column :trips, :traveler_profile, :jsonb, default: {}
    add_column :trips, :profile_status, :string, default: "pending"
  end
end
