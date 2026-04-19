class Api::V1::UsersController < ApplicationController
  before_action :require_service_request!, only: [:purge]

  # DELETE /api/v1/users/:id/purge
  # Called by the Supabase delete-account edge function when a user
  # deletes their account. Removes all user-owned data.
  def purge
    user_id = params[:id].to_s
    return render(json: { error: "missing_user_id" }, status: :bad_request) if user_id.blank?

    Trip.where(user_id: user_id).destroy_all

    render json: { success: true, user_id: user_id }
  end

  private

  def require_service_request!
    return if service_request?

    render json: { error: "forbidden" }, status: :forbidden
  end
end
