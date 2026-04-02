puts "Seeding database..."

trip = Trip.create!(
  name: "Tokyo Adventure",
  destination: "Tokyo, Japan",
  start_date: Date.new(2026, 5, 1),
  end_date: Date.new(2026, 5, 3),
  status: "active"
)

day1 = trip.day_plans.create!(day_number: 1, date: Date.new(2026, 5, 1))
day2 = trip.day_plans.create!(day_number: 2, date: Date.new(2026, 5, 2))
day3 = trip.day_plans.create!(day_number: 3, date: Date.new(2026, 5, 3))

# Day 1 - Asakusa & Akihabara
day1.itinerary_items.create!(
  name: "Senso-ji Temple",
  description: "Tokyo's oldest temple, famous for the giant red lantern at Kaminarimon Gate.",
  category: "attraction",
  time_slot: "09:00",
  duration_minutes: 90,
  position: 0,
  latitude: 35.7147651,
  longitude: 139.7966553,
  address: "2-3-1 Asakusa, Taito City, Tokyo 111-0032",
  google_place_id: "ChIJ8T1GpMGOGGARDYGSgpooDWw",
  google_rating: 4.5,
  google_reviews_count: 48000,
  operating_hours: { "Mon-Sun": "6:00 AM - 5:00 PM" },
  pricing_info: "Free"
)

day1.itinerary_items.create!(
  name: "Nakamise Shopping Street",
  description: "Traditional shopping street leading to Senso-ji with snacks and souvenirs.",
  category: "shopping",
  time_slot: "10:30",
  duration_minutes: 60,
  position: 1,
  latitude: 35.7119,
  longitude: 139.7955,
  address: "1-36-3 Asakusa, Taito City, Tokyo",
  google_rating: 4.3,
  google_reviews_count: 12000,
  pricing_info: "Varies"
)

day1.itinerary_items.create!(
  name: "Akihabara Electric Town",
  description: "World-famous electronics and anime district.",
  category: "attraction",
  time_slot: "14:00",
  duration_minutes: 180,
  position: 2,
  latitude: 35.7022589,
  longitude: 139.7744733,
  address: "Sotokanda, Chiyoda City, Tokyo",
  google_rating: 4.4,
  google_reviews_count: 5000,
  pricing_info: "Free to explore"
)

# Day 2 - Shibuya & Shinjuku
day2.itinerary_items.create!(
  name: "Shibuya Crossing",
  description: "The world's busiest pedestrian crossing, an iconic Tokyo landmark.",
  category: "attraction",
  time_slot: "10:00",
  duration_minutes: 30,
  position: 0,
  latitude: 35.6595,
  longitude: 139.7004,
  address: "2-2-1 Dogenzaka, Shibuya City, Tokyo",
  google_rating: 4.3,
  google_reviews_count: 35000,
  pricing_info: "Free"
)

day2.itinerary_items.create!(
  name: "Ichiran Ramen Shibuya",
  description: "Famous tonkotsu ramen chain with individual booth seating.",
  category: "restaurant",
  time_slot: "12:00",
  duration_minutes: 45,
  position: 1,
  latitude: 35.6614,
  longitude: 139.6988,
  address: "1-22-7 Jinnan, Shibuya City, Tokyo",
  google_rating: 4.2,
  google_reviews_count: 8000,
  pricing_info: "~1000 JPY per bowl"
)

day2.itinerary_items.create!(
  name: "Shinjuku Gyoen National Garden",
  description: "Beautiful park with Japanese, English, and French-style gardens.",
  category: "attraction",
  time_slot: "14:00",
  duration_minutes: 120,
  position: 2,
  latitude: 35.6852,
  longitude: 139.7100,
  address: "11 Naitocho, Shinjuku City, Tokyo 160-0014",
  google_rating: 4.6,
  google_reviews_count: 42000,
  operating_hours: { "Tue-Sun": "9:00 AM - 4:30 PM", "Mon": "Closed" },
  pricing_info: "500 JPY"
)

# Day 3 - Harajuku & Odaiba
day3.itinerary_items.create!(
  name: "Meiji Jingu Shrine",
  description: "Serene Shinto shrine surrounded by a vast forested area.",
  category: "attraction",
  time_slot: "09:00",
  duration_minutes: 90,
  position: 0,
  latitude: 35.6764,
  longitude: 139.6993,
  address: "1-1 Yoyogikamizonocho, Shibuya City, Tokyo 151-8557",
  google_rating: 4.6,
  google_reviews_count: 55000,
  operating_hours: { "Daily": "Sunrise - Sunset" },
  pricing_info: "Free"
)

day3.itinerary_items.create!(
  name: "Takeshita Street",
  description: "Famous Harajuku shopping street known for quirky fashion and crepes.",
  category: "shopping",
  time_slot: "11:00",
  duration_minutes: 90,
  position: 1,
  latitude: 35.6715,
  longitude: 139.7031,
  address: "1 Chome Jingumae, Shibuya City, Tokyo",
  google_rating: 4.1,
  google_reviews_count: 20000,
  pricing_info: "Varies"
)

# Sample links
trip.links.create!(url: "https://www.instagram.com/p/example-tokyo-food/")
trip.links.create!(url: "https://www.youtube.com/shorts/example-tokyo-walk")

puts "Seeded: #{Trip.count} trip, #{DayPlan.count} day plans, #{ItineraryItem.count} items, #{Link.count} links"
