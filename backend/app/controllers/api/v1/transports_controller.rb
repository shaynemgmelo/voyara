class Api::V1::TransportsController < Api::V1::BaseController
  before_action :set_trip
  before_action :set_transport, only: [:update, :destroy]

  def index
    render json: @trip.transports.order(:departure_date).map { |t| serialize(t) }
  end

  def create
    transport = @trip.transports.new(transport_params)
    if transport.save
      render json: serialize(transport), status: :created
    else
      render json: { errors: transport.errors.full_messages }, status: :unprocessable_entity
    end
  end

  def update
    if @transport.update(transport_params)
      render json: serialize(@transport)
    else
      render json: { errors: @transport.errors.full_messages }, status: :unprocessable_entity
    end
  end

  def destroy
    @transport.destroy
    head :no_content
  end

  private


  def set_transport
    @transport = @trip.transports.find(params[:id])
  end

  def transport_params
    params.require(:transport).permit(
      :transport_type, :company, :confirmation_number, :total_cost,
      :departure_date, :arrival_date, :pickup_location, :dropoff_location,
      :vehicle_info, :notes, :booked
    )
  end

  def serialize(transport)
    {
      id: transport.id,
      transport_type: transport.transport_type,
      company: transport.company,
      confirmation_number: transport.confirmation_number,
      total_cost: transport.total_cost,
      departure_date: transport.departure_date,
      arrival_date: transport.arrival_date,
      pickup_location: transport.pickup_location,
      dropoff_location: transport.dropoff_location,
      vehicle_info: transport.vehicle_info,
      notes: transport.notes,
      booked: transport.booked,
    }
  end
end
