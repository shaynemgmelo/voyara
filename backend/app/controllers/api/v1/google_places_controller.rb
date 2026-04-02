class Api::V1::GooglePlacesController < ApplicationController
  before_action :authenticate_user!
  GOOGLE_API_KEY = ENV["GOOGLE_PLACES_API_KEY"]

  def search
    query = params[:query]
    return render(json: { error: "query required" }, status: :bad_request) if query.blank?

    url = "https://maps.googleapis.com/maps/api/place/textsearch/json"
    response = HTTParty.get(url, query: {
      query: query,
      location: params[:location],
      key: GOOGLE_API_KEY
    })

    render json: response.parsed_response
  end

  def details
    place_id = params[:place_id]
    return render(json: { error: "place_id required" }, status: :bad_request) if place_id.blank?

    url = "https://maps.googleapis.com/maps/api/place/details/json"
    response = HTTParty.get(url, query: {
      place_id: place_id,
      fields: "name,formatted_address,geometry,rating,user_ratings_total,opening_hours,formatted_phone_number,website,price_level,photos",
      key: GOOGLE_API_KEY
    })

    render json: response.parsed_response
  end

  def autocomplete
    input = params[:input]
    return render(json: { error: "input required" }, status: :bad_request) if input.blank?

    url = "https://maps.googleapis.com/maps/api/place/autocomplete/json"
    response = HTTParty.get(url, query: {
      input: input,
      types: params[:types].presence || "establishment|geocode",
      key: GOOGLE_API_KEY
    })

    render json: response.parsed_response
  end
end
