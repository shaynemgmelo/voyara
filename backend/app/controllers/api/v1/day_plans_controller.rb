class Api::V1::DayPlansController < Api::V1::BaseController
  GOOGLE_API_KEY = ENV["GOOGLE_PLACES_API_KEY"]

  before_action :set_trip
  before_action :set_day_plan, only: [:show, :update, :destroy, :travel_times, :recalculate_schedule, :smart_suggestions]

  def index
    render json: @trip.day_plans.includes(:itinerary_items).map { |dp|
      DayPlanSerializer.new(dp).as_json
    }
  end

  def show
    render json: DayPlanSerializer.new(@day_plan).as_json
  end

  def create
    day_plan = @trip.day_plans.new(day_plan_params)

    if day_plan.save
      render json: DayPlanSerializer.new(day_plan).as_json, status: :created
    else
      render json: { errors: day_plan.errors.full_messages }, status: :unprocessable_entity
    end
  end

  def update
    if @day_plan.update(day_plan_params)
      render json: DayPlanSerializer.new(@day_plan).as_json
    else
      render json: { errors: @day_plan.errors.full_messages }, status: :unprocessable_entity
    end
  end

  def destroy
    @day_plan.destroy
    head :no_content
  end

  def travel_times
    items = @day_plan.itinerary_items.where.not(latitude: nil).order(:position)
    return render(json: { segments: [] }) if items.size < 2

    segments = []
    items.each_cons(2) do |from, to|
      segment = fetch_travel_segment(from, to)
      segments << segment if segment
    end

    render json: { segments: segments }
  end

  def recalculate_schedule
    items = @day_plan.itinerary_items.where.not(latitude: nil).order(:position)
    return render(json: { proposals: [] }) if items.size < 2

    proposals = []
    current_time = parse_time(items.first.time_slot || "09:00")

    items.each_with_index do |item, i|
      suggested = format_time(round_to_15(current_time))
      reason = nil

      if i > 0
        prev = items[i - 1]
        travel = cached_travel_duration(prev, item)
        if travel
          reason = "#{travel / 60} min from #{prev.name}"
        end
      end

      proposals << {
        item_id: item.id,
        name: item.name,
        current_time_slot: item.time_slot,
        suggested_time_slot: suggested,
        reason: reason
      }

      duration = item.duration_minutes || 60
      travel_next = (i < items.size - 1) ? (cached_travel_duration(item, items[i + 1]) || 900) : 0
      current_time += duration * 60 + travel_next
    end

    render json: { proposals: proposals }
  end

  def smart_suggestions
    items = @day_plan.itinerary_items.where.not(latitude: nil).order(:position)
    city = @day_plan.city || @trip.destination || "city"

    # Determine what's already on this day
    existing_categories = items.pluck(:category).compact
    existing_place_ids = @trip.itinerary_items.pluck(:google_place_id).compact
    existing_names = @trip.itinerary_items.pluck(:name).map(&:downcase)

    # Build search queries — ALWAYS start with iconic/popular attractions
    searches = []

    # 1. Top attractions first (most useful suggestions)
    searches << { query: "top rated tourist attractions #{city}" }

    # 2. Based on traveler interests
    profile = @trip.traveler_profile || {}
    interests = profile["interests"] || []
    if interests.any?
      # Pick the most specific interest
      best_interest = interests.reject { |i| i.length > 60 }.first || interests.first
      searches << { query: "#{best_interest} #{city}" }
    end

    # 3. Fill gaps: food if no restaurant, nightlife if nothing evening
    time_slots = items.filter_map(&:time_slot).sort
    has_food = existing_categories.any? { |c| %w[restaurant cafe].include?(c) }
    has_evening = time_slots.any? { |t| t >= "17:00" }

    unless has_food
      searches << { query: "best restaurants #{city}" }
    end

    unless has_evening
      searches << { query: "best rooftop bars dinner #{city}" }
    end

    # 4. Popular/general fallback
    searches << { query: "popular things to do #{city}" }

    # Use centroid of existing items for proximity, or fall back to text search
    center = nil
    if items.any?
      center = {
        lat: items.sum(&:latitude) / items.size,
        lng: items.sum(&:longitude) / items.size
      }
    end

    # Execute searches (max 3 API calls to save quota, each returns multiple results)
    all_suggestions = []
    seen_place_ids = Set.new(existing_place_ids)

    searches.uniq { |s| s[:query] }.first(4).each do |search|
      cache_key = "smart_sug:#{search[:query].parameterize}:#{center&.values&.map { |v| v.round(3) }&.join(',')}"
      results = Rails.cache.fetch(cache_key, expires_in: 24.hours) do
        query_params = { query: search[:query], key: GOOGLE_API_KEY }
        if center
          query_params[:location] = "#{center[:lat]},#{center[:lng]}"
          query_params[:radius] = 5000
        end

        response = HTTParty.get(
          "https://maps.googleapis.com/maps/api/place/textsearch/json",
          query: query_params
        )
        response.parsed_response["results"] || []
      end

      results.first(8).each do |r|
        next if seen_place_ids.include?(r["place_id"])
        next if existing_names.include?(r["name"]&.downcase)
        seen_place_ids.add(r["place_id"])

        photo_ref = r.dig("photos", 0, "photo_reference")
        all_suggestions << {
          name: r["name"],
          place_id: r["place_id"],
          rating: r["rating"],
          address: r["formatted_address"] || r["vicinity"],
          latitude: r.dig("geometry", "location", "lat"),
          longitude: r.dig("geometry", "location", "lng"),
          category: map_google_type_for_suggestion(r["types"]),
          photo: photo_ref ? "https://maps.googleapis.com/maps/api/place/photo?maxwidth=200&photo_reference=#{photo_ref}&key=#{GOOGLE_API_KEY}" : nil,
          distance: center ? distance_meters(center[:lat], center[:lng], r.dig("geometry", "location", "lat"), r.dig("geometry", "location", "lng")) : nil
        }
      end
    end

    # Sort: higher rated first, closer first
    sorted = all_suggestions.sort_by { |s| [-(s[:rating] || 0), s[:distance] || 99999] }

    render json: { suggestions: sorted.first(8) }
  end

  private

  def map_google_type_for_suggestion(types)
    return "restaurant" if types&.include?("restaurant")
    return "cafe" if types&.include?("cafe")
    return "nightlife" if types&.include?("night_club") || types&.include?("bar")
    return "shopping" if types&.include?("store") || types&.include?("shopping_mall")
    return "attraction" if types&.include?("museum") || types&.include?("tourist_attraction")
    return "activity" if types&.include?("park") || types&.include?("gym") || types&.include?("amusement_park")
    "attraction"
  end

  def distance_meters(lat1, lng1, lat2, lng2)
    return nil unless lat1 && lng1 && lat2 && lng2
    rad = Math::PI / 180
    dlat = (lat2 - lat1) * rad
    dlng = (lng2 - lng1) * rad
    a = Math.sin(dlat / 2)**2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dlng / 2)**2
    (6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).round
  end


  def set_day_plan
    @day_plan = @trip.day_plans.find(params[:id])
  end

  def day_plan_params
    params.require(:day_plan).permit(:day_number, :date, :notes, :city)
  end

  def fetch_travel_segment(from, to)
    walking = cached_directions(from, to, "walking")
    driving = cached_directions(from, to, "driving")
    return nil unless walking || driving

    {
      from_id: from.id,
      to_id: to.id,
      walking: walking,
      driving: driving
    }
  end

  def cached_directions(from, to, mode)
    origin_key = from.google_place_id || "#{from.latitude},#{from.longitude}"
    dest_key = to.google_place_id || "#{to.latitude},#{to.longitude}"
    cache_key = "travel:#{origin_key}:#{dest_key}:#{mode}"

    Rails.cache.fetch(cache_key, expires_in: 7.days) do
      origin = from.google_place_id ? "place_id:#{from.google_place_id}" : "#{from.latitude},#{from.longitude}"
      destination = to.google_place_id ? "place_id:#{to.google_place_id}" : "#{to.latitude},#{to.longitude}"

      response = HTTParty.get("https://maps.googleapis.com/maps/api/directions/json", query: {
        origin: origin,
        destination: destination,
        mode: mode,
        key: GOOGLE_API_KEY
      })

      data = response.parsed_response
      leg = data.dig("routes", 0, "legs", 0)
      return nil unless leg

      {
        duration_text: leg.dig("duration", "text"),
        duration_value: leg.dig("duration", "value"),
        distance_text: leg.dig("distance", "text")
      }
    end
  end

  def cached_travel_duration(from, to)
    origin_key = from.google_place_id || "#{from.latitude},#{from.longitude}"
    dest_key = to.google_place_id || "#{to.latitude},#{to.longitude}"
    cached = Rails.cache.read("travel:#{origin_key}:#{dest_key}:walking")
    cached&.dig(:duration_value)
  end

  def parse_time(slot)
    parts = slot.split(":")
    parts[0].to_i * 3600 + parts[1].to_i * 60
  end

  def format_time(seconds)
    h = (seconds / 3600) % 24
    m = (seconds % 3600) / 60
    format("%02d:%02d", h, m)
  end

  def round_to_15(seconds)
    ((seconds / 900.0).round * 900)
  end
end
