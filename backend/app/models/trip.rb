class Trip < ApplicationRecord
  STATUS_OPTIONS = %w[draft active completed archived].freeze
  AI_MODE_OPTIONS = %w[eco pro].freeze

  has_many :day_plans, -> { order(:day_number) }, dependent: :destroy
  has_many :links, dependent: :destroy
  has_many :itinerary_items, through: :day_plans
  has_many :flights, dependent: :destroy
  has_many :lodgings, dependent: :destroy
  has_many :transports, dependent: :destroy
  has_many :trip_notes, dependent: :destroy

  validates :name, presence: true
  validates :status, inclusion: { in: STATUS_OPTIONS }
  validates :ai_mode, inclusion: { in: AI_MODE_OPTIONS }
  validates :num_days, numericality: { greater_than: 0, less_than_or_equal_to: 30 }

  scope :active, -> { where(status: "active") }
end
