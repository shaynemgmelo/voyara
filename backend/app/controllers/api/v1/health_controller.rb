class Api::V1::HealthController < ApplicationController
  def index
    render json: { status: "ok", message: "Mapass API is running!" }
  end
end
