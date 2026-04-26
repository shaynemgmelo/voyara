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

  def strip_backend_owned_profile_fields(profile_hash)
    return profile_hash if profile_hash.blank?
    profile_hash = profile_hash.to_h
    BACKEND_OWNED_PROFILE_FIELDS.each { |k| profile_hash.delete(k) }
    profile_hash
  end
end
