class Trip < ApplicationRecord
  STATUS_OPTIONS = %w[draft active completed archived].freeze
  # `manual` = user wants to assemble the itinerary themselves; the AI service
  # still runs link extraction so the user gets a "places we found" panel to
  # drag from, but it skips the profile→Sonnet→Google-Places build pipeline.
  AI_MODE_OPTIONS = %w[eco pro manual].freeze

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

  # Refuse a num_days reduction that would chop days containing user content.
  # The controller surfaces this validation error in the JSON response so the
  # frontend can show a clear message ("delete items on day X first").
  validate :ensure_truncated_days_are_empty, if: :num_days_truly_decreased?

  # Keep day_plans in sync with num_days after the trip update commits. We
  # do this in an after-commit (not a regular callback) so that the trip's
  # final state is persisted before we mutate child rows — avoids partial
  # writes if a downstream callback raises.
  after_update_commit :sync_day_plans_with_num_days, if: :saved_num_days_change?

  scope :active, -> { where(status: "active") }

  private

  # Did num_days actually change in the most recent save?
  def saved_num_days_change?
    saved_change_to_num_days?
  end

  # Did num_days drop in this update? (Used by the validator BEFORE save —
  # uses Rails dirty-tracking on the about-to-be-saved value.)
  def num_days_truly_decreased?
    return false unless num_days_changed?
    old_value = num_days_was.to_i
    new_value = num_days.to_i
    new_value > 0 && new_value < old_value
  end

  # If shrinking, refuse if any of the day_plans being chopped have items.
  # Don't silently delete user content — the trip-detail page should ask
  # the user to clear those days first.
  def ensure_truncated_days_are_empty
    new_count = num_days.to_i
    return if new_count <= 0
    chopped = day_plans.where("day_number > ?", new_count).includes(:itinerary_items)
    populated = chopped.select { |dp| dp.itinerary_items.any? }
    return if populated.empty?

    nums = populated.map(&:day_number).sort
    errors.add(
      :num_days,
      "cannot shrink to #{new_count} — day#{nums.size == 1 ? '' : 's'} " \
      "#{nums.join(', ')} still have items. Remove them first."
    )
  end

  # Add empty days at the end (when growing) or remove trailing empty days
  # (when shrinking — already validated above to be safe).
  def sync_day_plans_with_num_days
    target = num_days.to_i
    return if target <= 0

    current_max = day_plans.maximum(:day_number).to_i

    if target > current_max
      # Grow: append fresh empty days. The DB columns origin/rigidity/
      # day_type all have defaults (ai_created / flexible / urban), but we
      # override origin to "user_edited" so downstream code knows this day
      # was added post-creation and shouldn't be treated like one extracted
      # from a video.
      ((current_max + 1)..target).each do |dnum|
        day_plans.create!(day_number: dnum, origin: "user_edited")
      end
    elsif target < current_max
      # Shrink: drop trailing days. The validator already confirmed they
      # have no itinerary_items, so destroy is non-destructive of user data.
      day_plans.where("day_number > ?", target).destroy_all
    end
  end
end
