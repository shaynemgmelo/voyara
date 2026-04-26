class ApplicationController < ActionController::API
  # Bump this whenever a breaking change ships to the v1 API surface
  # (renamed field, removed endpoint, semantics change). Frontend
  # compares against its compiled-in expectation; mismatch → console
  # warning + Sentry event (Tier 3 wires the Sentry side).
  #
  # Lives on ApplicationController (not Api::V1::BaseController) because
  # several v1 controllers (trips, health, users, google_places) inherit
  # directly from ApplicationController, and the header must fire on
  # EVERY API response to be useful.
  API_VERSION = "2026-04-26".freeze

  before_action :set_api_version_header

  private

  def set_api_version_header
    response.headers["X-API-Version"] = API_VERSION
  end


  # Decode and verify the Supabase JWT from the Authorization header.
  # Also supports service-to-service auth via X-Service-Key header (for AI service).
  # Returns the Supabase user UUID (sub claim), "service" for service auth, or nil.
  def current_user_id
    @current_user_id ||= begin
      # Check for service API key first (AI service → Rails API)
      service_key = request.headers["X-Service-Key"]
      if service_key.present? && service_key == ENV["SERVICE_API_KEY"]
        return "service"
      end

      # Check for Supabase JWT Bearer token
      token = request.headers["Authorization"]&.split("Bearer ")&.last
      return nil unless token.present?

      begin
        # Supabase uses ES256 (ECDSA P-256) for user access tokens.
        # Fetch the JWKS public key to verify the signature.
        jwk_set = self.class.supabase_jwks
        decoded = JWT.decode(token, nil, true, {
          algorithms: ["ES256"],
          jwks: jwk_set,
          verify_expiration: true,
        })
        payload = decoded.first
        Rails.logger.info("[auth] Authenticated user: #{payload['sub']}")
        payload["sub"] # Supabase user UUID
      rescue JWT::ExpiredSignature
        Rails.logger.info("[auth] Token expired")
        nil
      rescue JWT::DecodeError => e
        Rails.logger.info("[auth] Invalid token: #{e.message}")
        nil
      rescue => e
        Rails.logger.error("[auth] Unexpected error: #{e.class} #{e.message}")
        nil
      end
    end
  end

  # Cache the Supabase JWKS keys (fetched once per process)
  def self.supabase_jwks
    @supabase_jwks ||= begin
      supabase_url = ENV["SUPABASE_URL"]
      unless supabase_url.present?
        Rails.logger.warn("[auth] SUPABASE_URL not configured")
        return { keys: [] }
      end

      uri = URI("#{supabase_url}/auth/v1/.well-known/jwks.json")
      response = Net::HTTP.get(uri)
      jwks_data = JSON.parse(response)
      Rails.logger.info("[auth] Loaded #{jwks_data['keys']&.length} JWKS keys from Supabase")
      jwks_data
    rescue => e
      Rails.logger.error("[auth] Failed to fetch JWKS: #{e.message}")
      { "keys" => [] }
    end
  end

  # Is this a service-to-service call from the AI service?
  def service_request?
    current_user_id == "service"
  end

  # Require authentication — returns 401 if no valid token
  def authenticate_user!
    unless current_user_id
      render json: { error: "Unauthorized" }, status: :unauthorized
    end
  end
end
