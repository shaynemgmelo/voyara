class Api::V1::BaseController < ApplicationController
  before_action :authenticate_user!

  private

  # Nested resources scope through the user's trips.
  # Service requests (AI service) bypass user scoping.
  def set_trip
    if service_request?
      @trip = Trip.find(params[:trip_id])
    else
      @trip = Trip.where(user_id: current_user_id).find(params[:trip_id])
    end
  end
end
