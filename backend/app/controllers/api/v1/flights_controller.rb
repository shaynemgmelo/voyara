class Api::V1::FlightsController < Api::V1::BaseController
  before_action :set_trip
  before_action :set_flight, only: [:update, :destroy]

  def index
    render json: @trip.flights.order(:departure_date).map { |f| serialize(f) }
  end

  def create
    flight = @trip.flights.new(flight_params)
    if flight.save
      render json: serialize(flight), status: :created
    else
      render json: { errors: flight.errors.full_messages }, status: :unprocessable_entity
    end
  end

  def update
    if @flight.update(flight_params)
      render json: serialize(@flight)
    else
      render json: { errors: @flight.errors.full_messages }, status: :unprocessable_entity
    end
  end

  def destroy
    @flight.destroy
    head :no_content
  end

  private


  def set_flight
    @flight = @trip.flights.find(params[:id])
  end

  def flight_params
    params.require(:flight).permit(
      :airline, :flight_number, :confirmation_number, :total_cost,
      :departure_date, :arrival_date, :departure_airport, :arrival_airport,
      :seats, :notes, :booked
    )
  end

  def serialize(flight)
    {
      id: flight.id,
      airline: flight.airline,
      flight_number: flight.flight_number,
      confirmation_number: flight.confirmation_number,
      total_cost: flight.total_cost,
      departure_date: flight.departure_date,
      arrival_date: flight.arrival_date,
      departure_airport: flight.departure_airport,
      arrival_airport: flight.arrival_airport,
      seats: flight.seats,
      notes: flight.notes,
      booked: flight.booked,
    }
  end
end
