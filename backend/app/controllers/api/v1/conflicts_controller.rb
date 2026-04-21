class Api::V1::ConflictsController < Api::V1::BaseController
  # Phase 4 — surface the conflict_alerts that the AI pipeline attaches to
  # day_plans so the frontend can render a modal asking the user what to do.
  #
  # Each alert is a loose hash (the jsonb column accepts any shape), typical:
  #   { type: "locked_item_removal_attempt",
  #     item_id: 123,
  #     item_name: "Casa Rosada",
  #     message: "…",
  #     severity: "high",
  #     created_at: "2026-04-20T23:45:00Z" }

  before_action :set_trip

  # GET /api/v1/trips/:trip_id/conflicts
  # Returns a flat list with the originating day_plan_id so the UI can render
  # "Day 1 — 2 conflicts" style groupings.
  def index
    flat = []
    @trip.day_plans.includes(:itinerary_items).each do |dp|
      Array(dp.conflict_alerts).each do |alert|
        flat << alert.merge(
          "day_plan_id" => dp.id,
          "day_number" => dp.day_number,
          "city" => dp.city
        )
      end
    end
    render json: { conflicts: flat }
  end

  # POST /api/v1/trips/:trip_id/conflicts/resolve
  # Body: { day_plan_id: N, alert_index: I, resolution: "keep"|"replace"|"remove",
  #         replacement_name: "optional" }
  #
  # NOTE: we use `resolution` instead of `action` because `:action` is a Rails
  # reserved param (always equals the controller method name).
  def resolve
    day_plan = @trip.day_plans.find(params[:day_plan_id])
    alerts = Array(day_plan.conflict_alerts)
    idx = params[:alert_index].to_i
    if idx < 0 || idx >= alerts.size
      return render(json: { error: "alert not found" }, status: :not_found)
    end

    alert = alerts[idx]
    resolution = params[:resolution].to_s

    case resolution
    when "keep"
      # User wants to keep the locked item. Nothing to change on the item;
      # just drop the alert so it stops showing up.
      alerts.delete_at(idx)
      day_plan.update!(conflict_alerts: alerts)
      render json: { status: "kept", alert: alert }

    when "remove"
      # User confirms removal of a locked item.
      item_id = alert["item_id"]
      if item_id
        item = ItineraryItem.find_by(id: item_id, day_plan_id: day_plan.id)
        item&.destroy
      end
      alerts.delete_at(idx)
      day_plan.update!(conflict_alerts: alerts)
      render json: { status: "removed", alert: alert }

    when "replace"
      # User wants to replace — delete the locked item so a subsequent
      # refine can fill the slot. Frontend is expected to follow up with
      # a refine call containing `replacement_name` context.
      item_id = alert["item_id"]
      if item_id
        item = ItineraryItem.find_by(id: item_id, day_plan_id: day_plan.id)
        item&.destroy
      end
      alerts.delete_at(idx)
      day_plan.update!(conflict_alerts: alerts)
      render json: {
        status: "ready_to_replace",
        alert: alert,
        replacement_hint: params[:replacement_name]
      }

    else
      render json: { error: "resolution must be keep|replace|remove" }, status: :bad_request
    end
  end

  private

  def set_trip
    if service_request?
      @trip = Trip.find(params[:trip_id])
    else
      @trip = Trip.where(user_id: current_user_id).find(params[:trip_id])
    end
  end
end
