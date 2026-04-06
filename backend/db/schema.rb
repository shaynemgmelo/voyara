# This file is auto-generated from the current state of the database. Instead
# of editing this file, please use the migrations feature of Active Record to
# incrementally modify your database, and then regenerate this schema definition.
#
# This file is the source Rails uses to define your schema when running `bin/rails
# db:schema:load`. When creating a new database, `bin/rails db:schema:load` tends to
# be faster and is potentially less error prone than running all of your
# migrations from scratch. Old migrations may fail to apply correctly if those
# migrations use external dependencies or application code.
#
# It's strongly recommended that you check this file into your version control system.

ActiveRecord::Schema[8.0].define(version: 2026_04_02_004941) do
  # These are extensions that must be enabled in order to support this database
  enable_extension "pg_catalog.plpgsql"

  create_table "day_plans", force: :cascade do |t|
    t.string "city"
    t.datetime "created_at", null: false
    t.date "date"
    t.integer "day_number"
    t.text "notes"
    t.bigint "trip_id", null: false
    t.datetime "updated_at", null: false
    t.index ["trip_id", "city"], name: "index_day_plans_on_trip_id_and_city"
    t.index ["trip_id", "day_number"], name: "index_day_plans_on_trip_id_and_day_number", unique: true
    t.index ["trip_id"], name: "index_day_plans_on_trip_id"
  end

  create_table "flights", force: :cascade do |t|
    t.string "airline"
    t.string "arrival_airport"
    t.datetime "arrival_date"
    t.boolean "booked"
    t.string "confirmation_number"
    t.datetime "created_at", null: false
    t.string "departure_airport"
    t.datetime "departure_date"
    t.string "flight_number"
    t.text "notes"
    t.string "seats"
    t.string "total_cost"
    t.bigint "trip_id", null: false
    t.datetime "updated_at", null: false
    t.index ["trip_id"], name: "index_flights_on_trip_id"
  end

  create_table "itinerary_items", force: :cascade do |t|
    t.string "address"
    t.jsonb "alerts", default: []
    t.string "alternative_group"
    t.string "category"
    t.datetime "created_at", null: false
    t.bigint "day_plan_id", null: false
    t.text "description"
    t.integer "duration_minutes"
    t.string "google_place_id"
    t.decimal "google_rating", precision: 2, scale: 1
    t.integer "google_reviews_count"
    t.decimal "latitude", precision: 10, scale: 7
    t.decimal "longitude", precision: 10, scale: 7
    t.string "name"
    t.text "notes"
    t.jsonb "operating_hours", default: {}
    t.text "personal_notes"
    t.string "phone"
    t.jsonb "photos", default: []
    t.integer "position", default: 0, null: false
    t.string "pricing_info"
    t.string "source", default: "ai"
    t.string "source_url"
    t.string "time_slot"
    t.datetime "updated_at", null: false
    t.jsonb "vibe_tags", default: []
    t.string "website"
    t.index ["alternative_group"], name: "index_itinerary_items_on_alternative_group"
    t.index ["day_plan_id", "position"], name: "index_itinerary_items_on_day_plan_id_and_position"
    t.index ["day_plan_id"], name: "index_itinerary_items_on_day_plan_id"
    t.index ["google_place_id"], name: "index_itinerary_items_on_google_place_id"
    t.index ["vibe_tags"], name: "index_itinerary_items_on_vibe_tags", using: :gin
  end

  create_table "links", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.jsonb "extracted_data", default: {}
    t.string "platform"
    t.string "status", default: "pending", null: false
    t.bigint "trip_id", null: false
    t.datetime "updated_at", null: false
    t.string "url"
    t.index ["trip_id", "status"], name: "index_links_on_trip_id_and_status"
    t.index ["trip_id"], name: "index_links_on_trip_id"
  end

  create_table "lodgings", force: :cascade do |t|
    t.string "address"
    t.boolean "booked"
    t.date "check_in_date"
    t.string "check_in_time"
    t.date "check_out_date"
    t.string "check_out_time"
    t.string "confirmation_number"
    t.datetime "created_at", null: false
    t.string "email"
    t.string "google_place_id"
    t.decimal "google_rating", precision: 2, scale: 1
    t.decimal "latitude", precision: 10, scale: 7
    t.decimal "longitude", precision: 10, scale: 7
    t.string "name"
    t.text "notes"
    t.string "phone"
    t.string "total_cost"
    t.bigint "trip_id", null: false
    t.datetime "updated_at", null: false
    t.string "website"
    t.index ["trip_id"], name: "index_lodgings_on_trip_id"
  end

  create_table "transports", force: :cascade do |t|
    t.datetime "arrival_date"
    t.boolean "booked"
    t.string "company"
    t.string "confirmation_number"
    t.datetime "created_at", null: false
    t.datetime "departure_date"
    t.string "dropoff_location"
    t.text "notes"
    t.string "pickup_location"
    t.string "total_cost"
    t.string "transport_type"
    t.bigint "trip_id", null: false
    t.datetime "updated_at", null: false
    t.string "vehicle_info"
    t.index ["trip_id"], name: "index_transports_on_trip_id"
  end

  create_table "trip_notes", force: :cascade do |t|
    t.string "category"
    t.text "content"
    t.datetime "created_at", null: false
    t.string "title"
    t.bigint "trip_id", null: false
    t.datetime "updated_at", null: false
    t.index ["trip_id"], name: "index_trip_notes_on_trip_id"
  end

  create_table "trips", force: :cascade do |t|
    t.string "ai_mode", default: "eco", null: false
    t.datetime "created_at", null: false
    t.string "destination"
    t.date "end_date"
    t.string "name"
    t.integer "num_days", default: 5, null: false
    t.string "profile_status", default: "pending"
    t.date "start_date"
    t.string "status", default: "draft", null: false
    t.jsonb "traveler_profile", default: {}
    t.datetime "updated_at", null: false
    t.string "user_id"
    t.index ["status"], name: "index_trips_on_status"
    t.index ["user_id"], name: "index_trips_on_user_id"
  end

  add_foreign_key "day_plans", "trips"
  add_foreign_key "flights", "trips"
  add_foreign_key "itinerary_items", "day_plans"
  add_foreign_key "links", "trips"
  add_foreign_key "lodgings", "trips"
  add_foreign_key "transports", "trips"
  add_foreign_key "trip_notes", "trips"
end
