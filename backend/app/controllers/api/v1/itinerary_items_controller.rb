class Api::V1::ItineraryItemsController < Api::V1::BaseController
  GOOGLE_API_KEY = ENV["GOOGLE_PLACES_API_KEY"]

  COMPLEMENTARY_TYPES = {
    "restaurant" => "cafe|bar|bakery",
    "attraction" => "restaurant|cafe|museum|park",
    "activity" => "restaurant|cafe|park",
    "shopping" => "restaurant|cafe|bar",
    "hotel" => "restaurant|cafe|bar",
  }.freeze

  before_action :set_day_plan
  before_action :set_item, only: [:show, :update, :destroy, :move, :nearby_suggestions, :suggest_swap]

  def index
    render json: @day_plan.itinerary_items.map { |item|
      ItineraryItemSerializer.new(item).as_json
    }
  end

  def show
    render json: ItineraryItemSerializer.new(@item, expanded: true).as_json
  end

  def create
    item = @day_plan.itinerary_items.new(item_params)
    item.position ||= @day_plan.itinerary_items.maximum(:position).to_i + 1

    if item.save
      render json: ItineraryItemSerializer.new(item, expanded: true).as_json, status: :created
    else
      render json: { errors: item.errors.full_messages }, status: :unprocessable_entity
    end
  end

  def update
    if @item.update(item_params)
      render json: ItineraryItemSerializer.new(@item, expanded: true).as_json
    else
      render json: { errors: @item.errors.full_messages }, status: :unprocessable_entity
    end
  end

  def destroy
    @item.destroy
    head :no_content
  end

  def reorder
    item_ids = params[:item_ids]
    return render(json: { error: "item_ids required" }, status: :bad_request) unless item_ids.is_a?(Array)

    ActiveRecord::Base.transaction do
      item_ids.each_with_index do |id, index|
        @day_plan.itinerary_items.find(id).update!(position: index)
      end
    end

    render json: @day_plan.itinerary_items.reload.map { |item|
      ItineraryItemSerializer.new(item).as_json
    }
  end

  def move
    target_day_plan = DayPlan.find(params[:target_day_plan_id])
    new_position = params[:position] || target_day_plan.itinerary_items.maximum(:position).to_i + 1

    @item.update!(day_plan: target_day_plan, position: new_position)

    render json: ItineraryItemSerializer.new(@item, expanded: true).as_json
  end

  def nearby_suggestions
    return render(json: { suggestions: [] }) unless @item.latitude && @item.longitude

    cache_key = "nearby:#{@item.google_place_id || "#{@item.latitude},#{@item.longitude}"}"
    suggestions = Rails.cache.fetch(cache_key, expires_in: 24.hours) do
      types = COMPLEMENTARY_TYPES[@item.category] || "restaurant|cafe"
      url = "https://maps.googleapis.com/maps/api/place/nearbysearch/json"
      response = HTTParty.get(url, query: {
        location: "#{@item.latitude},#{@item.longitude}",
        radius: 500,
        type: types.split("|").first,
        key: GOOGLE_API_KEY
      })

      results = response.parsed_response["results"] || []
      results
        .reject { |r| r["place_id"] == @item.google_place_id }
        .first(3)
        .map do |r|
          photo_ref = r.dig("photos", 0, "photo_reference")
          {
            name: r["name"],
            place_id: r["place_id"],
            rating: r["rating"],
            address: r["vicinity"],
            latitude: r.dig("geometry", "location", "lat"),
            longitude: r.dig("geometry", "location", "lng"),
            category: map_google_type(r["types"]),
            photo: photo_ref ? "https://maps.googleapis.com/maps/api/place/photo?maxwidth=200&photo_reference=#{photo_ref}&key=#{GOOGLE_API_KEY}" : nil,
            distance: distance_meters(@item.latitude, @item.longitude, r.dig("geometry", "location", "lat"), r.dig("geometry", "location", "lng"))
          }
        end
    end

    render json: { suggestions: suggestions }
  end

  def suggest_swap
    return render(json: { suggestion: nil }) unless @item.latitude && @item.longitude

    cache_key = "swap:#{@item.google_place_id || "#{@item.latitude},#{@item.longitude}"}:#{@item.category}"
    suggestion = Rails.cache.fetch(cache_key, expires_in: 24.hours) do
      # Map our categories to Google Places types for same-category search
      type_map = {
        "restaurant" => "restaurant",
        "cafe" => "cafe",
        "attraction" => "tourist_attraction",
        "activity" => "tourist_attraction",
        "shopping" => "shopping_mall",
        "nightlife" => "night_club"
      }
      google_type = type_map[@item.category] || "tourist_attraction"

      response = HTTParty.get("https://maps.googleapis.com/maps/api/place/nearbysearch/json", query: {
        location: "#{@item.latitude},#{@item.longitude}",
        radius: 1500,
        type: google_type,
        key: GOOGLE_API_KEY
      })

      results = response.parsed_response["results"] || []

      # Exclude current item and any items already in this trip
      existing_place_ids = @trip.itinerary_items.pluck(:google_place_id).compact
      candidates = results.reject { |r| existing_place_ids.include?(r["place_id"]) }

      best = candidates.first
      next nil unless best

      photo_ref = best.dig("photos", 0, "photo_reference")
      {
        name: best["name"],
        place_id: best["place_id"],
        rating: best["rating"],
        address: best["vicinity"],
        latitude: best.dig("geometry", "location", "lat"),
        longitude: best.dig("geometry", "location", "lng"),
        category: @item.category,
        photo: photo_ref ? "https://maps.googleapis.com/maps/api/place/photo?maxwidth=300&photo_reference=#{photo_ref}&key=#{GOOGLE_API_KEY}" : nil,
        distance: distance_meters(@item.latitude, @item.longitude, best.dig("geometry", "location", "lat"), best.dig("geometry", "location", "lng"))
      }
    end

    render json: { suggestion: suggestion }
  end

  private

  def set_day_plan
    if service_request?
      @trip = Trip.find(params[:trip_id])
    else
      @trip = Trip.where(user_id: current_user_id).find(params[:trip_id])
    end
    @day_plan = @trip.day_plans.find(params[:day_plan_id])
  end

  def set_item
    @item = @day_plan.itinerary_items.find(params[:id])
  end

  def map_google_type(types)
    return "restaurant" if types&.include?("restaurant")
    return "shopping" if types&.include?("store") || types&.include?("shopping_mall")
    return "attraction" if types&.include?("museum") || types&.include?("tourist_attraction")
    return "activity" if types&.include?("park") || types&.include?("gym")
    "other"
  end

  def distance_meters(lat1, lng1, lat2, lng2)
    return nil unless lat1 && lng1 && lat2 && lng2
    rad = Math::PI / 180
    dlat = (lat2 - lat1) * rad
    dlng = (lng2 - lng1) * rad
    a = Math.sin(dlat / 2)**2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dlng / 2)**2
    (6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).round
  end

  def item_params
    params.require(:itinerary_item).permit(
      :name, :description, :category, :time_slot, :duration_minutes, :position,
      :latitude, :longitude, :address, :google_place_id, :google_rating,
      :google_reviews_count, :pricing_info, :phone, :website, :notes, :source_url,
      :personal_notes, :alternative_group, :source,
      # New provenance + editability fields (Phase 1 of the reform).
      :origin, :source_video_url, :source_video_creator, :extraction_method,
      :priority, :item_status, :best_turn, :region,
      # Camada 4 — planning model per item.
      :activity_model, :visit_mode,
      operating_hours: {}, photos: [], vibe_tags: [], alerts: []
    )
  end
end
