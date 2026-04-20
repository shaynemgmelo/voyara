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
      # Phase 1 reform — provenance + rigidity metadata. Frontend reads these
      # to render badges ("Dia 1 — estrutura do @creator"), lock icons, and
      # day_type chips ("🚗 Bate-volta — Tigre").
      origin: @day_plan.origin,
      rigidity: @day_plan.rigidity,
      day_type: @day_plan.day_type,
      primary_region: @day_plan.primary_region,
      source_video_url: @day_plan.source_video_url,
      source_creator_handle: @day_plan.source_creator_handle,
      estimated_pace: @day_plan.estimated_pace,
      pattern_signature: @day_plan.pattern_signature,
      conflict_alerts: @day_plan.conflict_alerts,
      itinerary_items: @day_plan.itinerary_items.map do |item|
        ItineraryItemSerializer.new(item).as_json
      end,
      created_at: @day_plan.created_at
    }
  end
end
