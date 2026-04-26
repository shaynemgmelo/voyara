# Defensive backend-side mirror of frontend/src/utils/profileFields.js.
# Strips backend-owned fields from a traveler_profile hash before merge.
#
# Why: even though the frontend now strips these fields, a stale
# browser tab, a third-party caller, or a future client (mobile app)
# might not. Backend defense keeps the contract enforceable regardless
# of who's calling.
#
# Keep this set in sync with frontend/src/utils/profileFields.js.
# (Tier 2 of the bug-proofing roadmap will add a CI check that asserts
# parity between the two lists.)
#
# Behavior:
#   - Returns a NEW hash (does not mutate the input).
#   - No-op if the input is blank — returns the original.
#
# Callers MUST decide whether to apply this — service-to-service writes
# (e.g. AI service via X-Service-Key auth) need to BYPASS the strip
# (otherwise enrichment writes get clobbered). Typical pattern:
#   strip_backend_owned_profile_fields(hash) unless service_request?
#
# Usable two ways:
#   - `include ProfileFieldGuard` then call
#     `strip_backend_owned_profile_fields(hash)`
#   - `ProfileFieldGuard.strip_backend_owned_profile_fields(hash)` directly
#     (background jobs, model hooks, anywhere a controller concern
#     include is awkward) — mirrors the JsonColumnMerge sibling concern.
module ProfileFieldGuard
  extend ActiveSupport::Concern

  BACKEND_OWNED_PROFILE_FIELDS = %w[
    places_mentioned
    day_plans_from_links
    external_research
    external_research_flexible
    destination_classification
    city_distribution
    build_error
    validation_report
  ].freeze

  module_function

  def strip_backend_owned_profile_fields(profile_hash)
    return profile_hash if profile_hash.blank?
    profile_hash.to_h.except(*BACKEND_OWNED_PROFILE_FIELDS)
  end
end
