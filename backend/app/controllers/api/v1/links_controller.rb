class Api::V1::LinksController < Api::V1::BaseController
  include JsonColumnMerge

  skip_before_action :authenticate_user!, only: [:pending]
  before_action :set_trip, except: [:pending]
  before_action :set_link, only: [:show, :update, :destroy]

  def index
    render json: @trip.links.map { |l| LinkSerializer.new(l).as_json }
  end

  def show
    render json: LinkSerializer.new(@link).as_json
  end

  def create
    link = @trip.links.new(link_params)

    if link.save
      render json: LinkSerializer.new(link).as_json, status: :created
    else
      render json: { errors: link.errors.full_messages }, status: :unprocessable_entity
    end
  end

  def update
    permitted = link_update_params.to_h
    # extracted_data is a HASH JSON column — deep-merge so a partial
    # PATCH from anywhere (frontend or AI service) doesn't wipe the
    # other writer's freshly-enriched keys.
    if permitted["extracted_data"].present?
      permitted["extracted_data"] = merge_json_column(
        @link.extracted_data, permitted["extracted_data"],
      )
    end
    if @link.update(permitted)
      render json: LinkSerializer.new(@link).as_json
    else
      render json: { errors: @link.errors.full_messages }, status: :unprocessable_entity
    end
  end

  def destroy
    @link.destroy
    head :no_content
  end

  # GET /api/v1/links/pending — returns all pending links across all trips
  def pending
    links = Link.where(status: "pending").includes(:trip)
    render json: links.map { |l|
      LinkSerializer.new(l).as_json.merge(
        trip_name: l.trip.name,
        trip_destination: l.trip.destination
      )
    }
  end

  private

  def set_link
    @link = @trip.links.find(params[:id])
  end

  def link_params
    params.require(:link).permit(:url)
  end

  def link_update_params
    params.require(:link).permit(:status, extracted_data: {})
  end
end
