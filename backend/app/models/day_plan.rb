class DayPlan < ApplicationRecord
  belongs_to :trip
  has_many :itinerary_items, -> { order(:position) }, dependent: :destroy

  validates :day_number, presence: true,
    numericality: { greater_than: 0 },
    uniqueness: { scope: :trip_id }
end
