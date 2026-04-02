class Transport < ApplicationRecord
  belongs_to :trip

  TRANSPORT_TYPES = %w[car_rental train bus ferry rideshare other].freeze
  validates :transport_type, inclusion: { in: TRANSPORT_TYPES }
end
