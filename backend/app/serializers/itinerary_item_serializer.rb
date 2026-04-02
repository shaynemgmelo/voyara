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
      source: @item.source,
      source_url: @item.source_url,
      personal_notes: @item.personal_notes,
      vibe_tags: @item.vibe_tags,
      alerts: @item.alerts,
      alternative_group: @item.alternative_group
    }
  end
end
