class Api::V1::TripsController < ApplicationController
  before_action :authenticate_user!, except: [:shared]
  before_action :set_trip, only: [:show, :update, :destroy, :share, :unshare, :build]

  def index
    trips = user_trips
    trips = trips.where(status: params[:status]) if params[:status].present?
    render json: trips.map { |t| TripSerializer.new(t).as_json }
  end

  def show
    render json: TripSerializer.new(@trip, include_details: true).as_json
  end

  def create
    trip = Trip.new(trip_params)
    trip.user_id = current_user_id

    if trip.save
      generate_day_plans(trip)
      render json: TripSerializer.new(trip, include_details: true).as_json, status: :created
    else
      render json: { errors: trip.errors.full_messages }, status: :unprocessable_entity
    end
  end

  def update
    # Deep-merge traveler_profile instead of replacing it. Trip 46
    # surfaced this: the frontend PATCHed a stale traveler_profile
    # snapshot (taken BEFORE the AI service finished geocoding) which
    # clobbered the freshly-enriched places_mentioned. Result: cards
    # showed "no data", map pins disappeared.
    #
    # The frontend now sends only fields it OWNS (travel_style,
    # interests, etc.), and Rails merges those into the existing
    # traveler_profile JSON without touching backend-managed keys
    # (places_mentioned, day_plans_from_links, external_research, etc.).
    permitted = trip_params
    if permitted[:traveler_profile].present? && @trip.traveler_profile.present?
      permitted = permitted.to_h
      permitted["traveler_profile"] = @trip.traveler_profile.deep_merge(
        permitted["traveler_profile"].to_h,
      )
    end

    if @trip.update(permitted)
      render json: TripSerializer.new(@trip, include_details: true).as_json
    else
      render json: { errors: @trip.errors.full_messages }, status: :unprocessable_entity
    end
  end

  def destroy
    @trip.destroy
    head :no_content
  end

  def share
    if @trip.share_token.blank?
      @trip.update!(share_token: SecureRandom.urlsafe_base64(16), shared_at: Time.current)
    end
    render json: { share_token: @trip.share_token, shared_at: @trip.shared_at }
  end

  def unshare
    @trip.update!(share_token: nil, shared_at: nil)
    head :no_content
  end

  def shared
    trip = Trip.find_by(share_token: params[:token])
    return render(json: { error: "not_found" }, status: :not_found) unless trip

    render json: TripSerializer.new(trip, include_details: true).as_json
  end

  # POST /api/v1/trips/:id/build
  # Single entry point for the new deferred-extraction flow. Fired when the
  # user clicks "Generate" on the trip-create form.
  #
  # Accepts an optional `links: [url, ...]` array — those get persisted as
  # Link records via insert_all (which BYPASSES after_create_commit so the
  # OLD per-link extraction callback doesn't fire and race the new pipeline).
  # The combined extract→profile→build pipeline on the AI service then runs
  # against every link on the trip in one background task.
  def build
    urls = Array(params[:links]).map(&:to_s).reject(&:blank?).uniq
    if urls.any?
      now = Time.current
      rows = urls.map do |url|
        platform = detect_platform_for(url)
        {
          trip_id: @trip.id,
          url: url,
          platform: platform,
          status: "pending",
          created_at: now,
          updated_at: now
        }
      end
      # insert_all skips callbacks → no per-link extraction race with the
      # combined pipeline below. Returns gracefully on duplicates if there's
      # a unique index (currently none, but harmless).
      Link.insert_all(rows) if rows.any?
    end

    ai_service_url = ENV.fetch("AI_SERVICE_URL", "http://localhost:8000")
    response = HTTParty.post(
      "#{ai_service_url}/api/extract-and-build/#{@trip.id}",
      headers: { "Content-Type" => "application/json" },
      timeout: 15
    )
    if response.success?
      render json: { status: "accepted", message: "Build triggered for trip #{@trip.id}" }, status: :accepted
    else
      render json: { error: "AI service rejected build", details: response.body }, status: :bad_gateway
    end
  rescue StandardError => e
    Rails.logger.error "Build trigger failed for trip #{@trip.id}: #{e.message}"
    render json: { error: "AI service unreachable", details: e.message }, status: :service_unavailable
  end

  private

  def user_trips
    if service_request?
      Trip.all
    else
      Trip.where(user_id: current_user_id)
    end
  end

  def set_trip
    @trip = user_trips.find(params[:id])
  end

  def trip_params
    params.require(:trip).permit(:name, :destination, :num_days, :status, :ai_mode, :profile_status, :is_staging, traveler_profile: {})
  end

  def generate_day_plans(trip)
    trip.num_days.times do |i|
      trip.day_plans.create!(day_number: i + 1)
    end
  end

  # Mirrors the Link model's :detect_platform callback. Used by the build
  # action when bulk-inserting links via insert_all (which bypasses the
  # before_validation callback). Keep the regex set in sync with the model.
  def detect_platform_for(url)
    host = URI.parse(url).host.to_s.downcase
    case host
    when /instagram/ then "instagram"
    when /youtube|youtu\.be/ then "youtube"
    when /tiktok/ then "tiktok"
    else "other"
    end
  rescue URI::InvalidURIError
    "other"
  end
end
