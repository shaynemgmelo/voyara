class TripSerializer
  def initialize(trip, options = {})
    @trip = trip
    @include_details = options[:include_details] || false
  end

  def as_json
    data = {
      id: @trip.id,
      name: @trip.name,
      destination: @trip.destination,
      num_days: @trip.num_days,
      status: @trip.status,
      ai_mode: @trip.ai_mode,
      traveler_profile: @trip.traveler_profile,
      profile_status: @trip.profile_status,
      day_plans_count: @trip.day_plans.size,
      items_count: @trip.itinerary_items.size,
      links_count: @trip.links.size,
      created_at: @trip.created_at,
      updated_at: @trip.updated_at
    }

    if @include_details
      data[:day_plans] = @trip.day_plans.includes(:itinerary_items).map do |dp|
        DayPlanSerializer.new(dp).as_json
      end
      data[:links] = @trip.links.map { |l| LinkSerializer.new(l).as_json }
      data[:flights] = @trip.flights.order(:departure_date)
      data[:lodgings] = @trip.lodgings.order(:check_in_date)
      data[:transports] = @trip.transports.order(:departure_date)
      data[:trip_notes] = @trip.trip_notes.order(:created_at)
    end

    data
  end
end
