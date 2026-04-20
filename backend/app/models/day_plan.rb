class DayPlan < ApplicationRecord
  # Valid values for each enum-like string column. Kept as module constants
  # (rather than ActiveRecord enum) so the underlying storage is a plain string
  # and we can read/write from Python/AI pipelines without surprises.
  ORIGINS       = %w[from_video ai_created user_edited].freeze
  RIGIDITIES    = %w[locked partially_flexible flexible].freeze
  DAY_TYPES     = %w[urban day_trip transfer].freeze
  PACES         = %w[leve moderado acelerado].freeze

  belongs_to :trip
  has_many :itinerary_items, -> { order(:position) }, dependent: :destroy

  validates :day_number, presence: true,
    numericality: { greater_than: 0 },
    uniqueness: { scope: :trip_id }

  validates :origin,   inclusion: { in: ORIGINS }
  validates :rigidity, inclusion: { in: RIGIDITIES }
  validates :day_type, inclusion: { in: DAY_TYPES }
  validates :estimated_pace, inclusion: { in: PACES }, allow_nil: true

  # Convenience predicates for downstream code/AI pipeline.
  def locked?;              rigidity == "locked";              end
  def partially_flexible?;  rigidity == "partially_flexible";  end
  def flexible?;            rigidity == "flexible";            end
  def from_video?;          origin   == "from_video";          end
  def day_trip?;            day_type == "day_trip";            end
end
