class Link < ApplicationRecord
  PLATFORM_OPTIONS = %w[instagram youtube tiktok blog other].freeze
  STATUS_OPTIONS = %w[pending processing extracted processed failed].freeze

  belongs_to :trip

  validates :url, presence: true
  validates :status, inclusion: { in: STATUS_OPTIONS }

  before_validation :detect_platform, if: -> { platform.blank? && url.present? }
  after_create_commit :notify_ai_service
  after_update_commit :check_all_extracted, if: -> { saved_change_to_status? && status == "extracted" }

  private

  def notify_ai_service
    ai_service_url = ENV.fetch("AI_SERVICE_URL", "http://localhost:8000")
    HTTParty.post(
      "#{ai_service_url}/api/process-link",
      body: {
        link_id: id,
        trip_id: trip_id,
        url: url,
        platform: platform,
        ai_mode: trip.ai_mode
      }.to_json,
      headers: { "Content-Type" => "application/json" },
      timeout: 15
    )
  rescue StandardError => e
    Rails.logger.warn "AI service notification failed: #{e.message}"
  end

  def check_all_extracted
    # When this link is extracted, check if ALL links for this trip are extracted.
    # If so, trigger aggregated profile analysis on the AI service.
    return if trip.profile_status == "suggested" || trip.profile_status == "confirmed"

    pending_links = trip.links.where(status: %w[pending processing])
    return if pending_links.exists?

    extracted_links = trip.links.where(status: "extracted")
    return unless extracted_links.exists?

    Rails.logger.info "All links extracted for trip #{trip_id} — triggering profile analysis"
    ai_service_url = ENV.fetch("AI_SERVICE_URL", "http://localhost:8000")
    HTTParty.post(
      "#{ai_service_url}/api/analyze-trip/#{trip_id}",
      headers: { "Content-Type" => "application/json" },
      timeout: 15
    )
  rescue StandardError => e
    Rails.logger.warn "Profile analysis trigger failed: #{e.message}"
  end

  def detect_platform
    host = URI.parse(url).host.to_s.downcase
    self.platform = case host
    when /instagram/ then "instagram"
    when /youtube|youtu\.be/ then "youtube"
    when /tiktok/ then "tiktok"
    else "other"
    end
  rescue URI::InvalidURIError
    self.platform = "other"
  end
end
