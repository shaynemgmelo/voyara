# Deep-merges an incoming JSON-column update into the existing value
# instead of replacing it. Used by every controller PATCH that accepts
# a JSON column the frontend might send only PARTIALLY.
#
# Trip 46 surfaced the bug class this concern protects against:
# the frontend cached a stale snapshot of traveler_profile (taken
# BEFORE the AI service finished geocoding 53 places), then PATCHed
# the WHOLE profile back. Rails replaced the JSON column wholesale,
# clobbering the freshly-enriched places_mentioned. Cards showed
# "no data", map pins disappeared.
#
# Behavior:
#   - Hashes deep-merge — incoming keys win, missing keys preserved
#   - Arrays REPLACE — if incoming sends [], existing list is wiped
#     (this is intentional: arrays are atomic; a partial-array update
#     would be ambiguous about ordering / dedup)
#   - nil-safe on either side
module JsonColumnMerge
  extend ActiveSupport::Concern

  def merge_json_column(existing, incoming)
    return (incoming || {}) if existing.blank?
    return existing if incoming.blank?
    existing.deep_merge(incoming.to_h)
  end
end
