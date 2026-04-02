class DayPlanSerializer
  def initialize(day_plan)
    @day_plan = day_plan
  end

  def as_json
    {
      id: @day_plan.id,
      trip_id: @day_plan.trip_id,
      day_number: @day_plan.day_number,
      date: @day_plan.date,
      notes: @day_plan.notes,
      city: @day_plan.city,
      itinerary_items: @day_plan.itinerary_items.map do |item|
        ItineraryItemSerializer.new(item).as_json
      end,
      created_at: @day_plan.created_at
    }
  end
end
