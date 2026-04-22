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
    if @trip.update(trip_params)
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
  # user clicks "Generate" on the trip-create form. Triggers the AI service's
  # combined extract → profile → build pipeline as one background task.
  def build
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
    params.require(:trip).permit(:name, :destination, :num_days, :status, :ai_mode, :profile_status, traveler_profile: {})
  end

  def generate_day_plans(trip)
    trip.num_days.times do |i|
      trip.day_plans.create!(day_number: i + 1)
    end
  end
end
