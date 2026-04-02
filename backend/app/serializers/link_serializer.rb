class LinkSerializer
  def initialize(link)
    @link = link
  end

  def as_json
    {
      id: @link.id,
      trip_id: @link.trip_id,
      url: @link.url,
      platform: @link.platform,
      status: @link.status,
      extracted_data: @link.extracted_data,
      created_at: @link.created_at
    }
  end
end
