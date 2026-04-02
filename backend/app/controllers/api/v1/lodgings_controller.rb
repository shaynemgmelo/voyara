class Api::V1::LodgingsController < Api::V1::BaseController
  before_action :set_trip
  before_action :set_lodging, only: [:update, :destroy]

  def index
    render json: @trip.lodgings.order(:check_in_date).map { |l| serialize(l) }
  end

  def create
    lodging = @trip.lodgings.new(lodging_params)
    if lodging.save
      render json: serialize(lodging), status: :created
    else
      render json: { errors: lodging.errors.full_messages }, status: :unprocessable_entity
    end
  end

  def update
    if @lodging.update(lodging_params)
      render json: serialize(@lodging)
    else
      render json: { errors: @lodging.errors.full_messages }, status: :unprocessable_entity
    end
  end

  def destroy
    @lodging.destroy
    head :no_content
  end

  private


  def set_lodging
    @lodging = @trip.lodgings.find(params[:id])
  end

  def lodging_params
    params.require(:lodging).permit(
      :name, :address, :check_in_date, :check_in_time, :check_out_date, :check_out_time,
      :confirmation_number, :total_cost, :phone, :website, :email, :notes, :booked,
      :latitude, :longitude, :google_place_id, :google_rating
    )
  end

  def serialize(lodging)
    {
      id: lodging.id,
      name: lodging.name,
      address: lodging.address,
      check_in_date: lodging.check_in_date,
      check_in_time: lodging.check_in_time,
      check_out_date: lodging.check_out_date,
      check_out_time: lodging.check_out_time,
      confirmation_number: lodging.confirmation_number,
      total_cost: lodging.total_cost,
      phone: lodging.phone,
      website: lodging.website,
      email: lodging.email,
      notes: lodging.notes,
      booked: lodging.booked,
      latitude: lodging.latitude,
      longitude: lodging.longitude,
      google_place_id: lodging.google_place_id,
      google_rating: lodging.google_rating,
    }
  end
end
