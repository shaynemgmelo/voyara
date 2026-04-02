class AddAiModeToTrips < ActiveRecord::Migration[8.1]
  def change
    add_column :trips, :ai_mode, :string, default: "eco", null: false
  end
end
