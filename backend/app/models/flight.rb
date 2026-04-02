class Flight < ApplicationRecord
  belongs_to :trip

  validates :airline, presence: true
end
