class ApplicationController < ActionController::API
  private

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

      jwt_secret = ENV["SUPABASE_JWT_SECRET"]
      unless jwt_secret.present?
        Rails.logger.warn("[auth] SUPABASE_JWT_SECRET not configured")
        return nil
      end

      begin
        decoded = JWT.decode(
          token,
          jwt_secret,
          true,
          {
            algorithms: ["HS256"],
            verify_expiration: true,
          }
        )
        payload = decoded.first
        payload["sub"] # Supabase user UUID
      rescue JWT::ExpiredSignature
        Rails.logger.info("[auth] Token expired")
        nil
      rescue JWT::DecodeError => e
        Rails.logger.info("[auth] Invalid token: #{e.message}")
        nil
      end
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
