class TripNote < ApplicationRecord
  belongs_to :trip

  CATEGORIES = %w[general packing documents tips budget].freeze
end
