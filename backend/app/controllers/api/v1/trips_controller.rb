class Api::V1::TripsController < ApplicationController
  before_action :authenticate_user!
  before_action :set_trip, only: [:show, :update, :destroy]

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
