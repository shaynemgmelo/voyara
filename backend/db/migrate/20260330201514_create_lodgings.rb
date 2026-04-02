class CreateLodgings < ActiveRecord::Migration[8.1]
  def change
    create_table :lodgings do |t|
      t.string :name
      t.string :address
      t.date :check_in_date
      t.string :check_in_time
      t.date :check_out_date
      t.string :check_out_time
      t.string :confirmation_number
      t.string :total_cost
      t.string :phone
      t.string :website
      t.string :email
      t.text :notes
      t.boolean :booked
      t.references :trip, null: false, foreign_key: true

      t.timestamps
    end
  end
end
