class ItineraryItem < ApplicationRecord
  CATEGORY_OPTIONS = %w[restaurant attraction hotel transport activity shopping cafe nightlife other].freeze

  belongs_to :day_plan
  has_one :trip, through: :day_plan

  validates :name, presence: true
  validates :category, inclusion: { in: CATEGORY_OPTIONS }, allow_nil: true
end
