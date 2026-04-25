class AddIsStagingToTrips < ActiveRecord::Migration[8.0]
  # Staging-trip flag. Lets the developer (or anyone) test pipeline
  # changes without polluting their real travel-planning trips. Filtered
  # / badged separately in the UI; orchestrator behavior is identical.
  def change
    add_column :trips, :is_staging, :boolean, default: false, null: false
    add_index :trips, :is_staging
  end
end
