class AddAiModeToTrips < ActiveRecord::Migration[8.0]
  def change
    add_column :trips, :ai_mode, :string, default: "eco", null: false
  end
end
