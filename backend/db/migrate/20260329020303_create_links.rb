class CreateLinks < ActiveRecord::Migration[8.1]
  def change
    create_table :links do |t|
      t.references :trip, null: false, foreign_key: true
      t.string :url
      t.string :platform
      t.string :status, default: "pending", null: false
      t.jsonb :extracted_data, default: {}

      t.timestamps
    end

    add_index :links, [:trip_id, :status]
  end
end
