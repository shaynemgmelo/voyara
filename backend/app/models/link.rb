class Link < ApplicationRecord
  PLATFORM_OPTIONS = %w[instagram youtube tiktok blog other].freeze
  STATUS_OPTIONS = %w[pending processing extracted processed failed].freeze

  belongs_to :trip

  validates :url, presence: true
  validates :status, inclusion: { in: STATUS_OPTIONS }

  before_validation :detect_platform, if: -> { platform.blank? && url.present? }

  # Note: link create/extract callbacks were removed in the deferred-extraction
  # redesign. Extraction no longer fires when a link is added — instead the
  # AI service runs extract → profile → build as a single combined pipeline
  # when the user clicks "Generate" (POST /trips/:id/build, which calls
  # /api/extract-and-build/:trip_id on the AI service).

  private

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
