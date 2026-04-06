class CreateTripNotes < ActiveRecord::Migration[8.0]
  def change
    create_table :trip_notes do |t|
      t.string :title
      t.text :content
      t.string :category
      t.references :trip, null: false, foreign_key: true

      t.timestamps
    end
  end
end
