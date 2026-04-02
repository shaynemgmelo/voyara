class Api::V1::HealthController < ApplicationController
  def index
    render json: { status: "ok", message: "ai.itinerary API is running!" }
  end
end
