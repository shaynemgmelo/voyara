class ItineraryItemSerializer
  def initialize(item, options = {})
    @item = item
  end

  def as_json
    {
      id: @item.id,
      day_plan_id: @item.day_plan_id,
      name: @item.name,
      description: @item.description,
      category: @item.category,
      time_slot: @item.time_slot,
      duration_minutes: @item.duration_minutes,
      position: @item.position,
      latitude: @item.latitude,
      longitude: @item.longitude,
      address: @item.address,
      google_place_id: @item.google_place_id,
      google_rating: @item.google_rating,
      google_reviews_count: @item.google_reviews_count,
      operating_hours: @item.operating_hours,
      pricing_info: @item.pricing_info,
      phone: @item.phone,
      website: @item.website,
      photos: @item.photos,
      notes: @item.notes,
      # Legacy binary source kept for backward compatibility. Frontend should
      # prefer `origin` going forward — the legacy field will be removed in a
      # later migration once all readers are updated.
      source: @item.source,
      source_url: @item.source_url,
      # Phase 1 reform fields — richer provenance + editability metadata.
      origin: @item.origin,
      source_video_url: @item.source_video_url,
      source_video_creator: @item.source_video_creator,
      extraction_method: @item.extraction_method,
      priority: @item.priority,
      item_status: @item.item_status,
      best_turn: @item.best_turn,
      region: @item.region,
      # Camada 4 — planning model per item.
      activity_model: @item.activity_model,
      visit_mode: @item.visit_mode,
      # STEP 2 — semantic role for UI icons / filters.
      item_role: @item.item_role,
      personal_notes: @item.personal_notes,
      vibe_tags: @item.vibe_tags,
      alerts: @item.alerts,
      alternative_group: @item.alternative_group
    }
  end
end
