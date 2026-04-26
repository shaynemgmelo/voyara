return unless ENV["SENTRY_DSN"].present?

Sentry.init do |config|
  config.dsn = ENV["SENTRY_DSN"]
  config.breadcrumbs_logger = [:active_support_logger, :http_logger]
  # Capture 100% of errors in dev/staging, 10% transactions in prod
  # to keep Sentry quota under control.
  config.traces_sample_rate = Rails.env.production? ? 0.1 : 1.0
  config.environment = Rails.env
  config.release = ENV["RENDER_GIT_COMMIT"]&.first(7)
  # Don't ship PII unless we explicitly opt-in per event.
  config.send_default_pii = false
end
