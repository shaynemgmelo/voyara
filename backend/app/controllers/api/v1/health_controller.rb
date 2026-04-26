class Api::V1::HealthController < ApplicationController
  def index
    # TEMPORARY — bug-proofing Sentry verification. Will be reverted in next commit.
    if params[:sentry_test] == "message" && defined?(Sentry)
      Sentry.capture_message("✅ Rails Sentry verification — message capture works in prod")
    end
    if params[:sentry_test] == "raise"
      raise StandardError.new("✅ Rails Sentry verification — exception capture works in prod")
    end
    render json: { status: "ok", message: "Mapass API is running!" }
  end
end
