class Api::V1::TripNotesController < Api::V1::BaseController
  before_action :set_trip
  before_action :set_note, only: [:update, :destroy]

  def index
    render json: @trip.trip_notes.order(:created_at).map { |n| serialize(n) }
  end

  def create
    note = @trip.trip_notes.new(note_params)
    if note.save
      render json: serialize(note), status: :created
    else
      render json: { errors: note.errors.full_messages }, status: :unprocessable_entity
    end
  end

  def update
    if @note.update(note_params)
      render json: serialize(@note)
    else
      render json: { errors: @note.errors.full_messages }, status: :unprocessable_entity
    end
  end

  def destroy
    @note.destroy
    head :no_content
  end

  private


  def set_note
    @note = @trip.trip_notes.find(params[:id])
  end

  def note_params
    params.require(:trip_note).permit(:title, :content, :category)
  end

  def serialize(note)
    {
      id: note.id,
      title: note.title,
      content: note.content,
      category: note.category,
      created_at: note.created_at,
    }
  end
end
