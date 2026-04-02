"""
Tool definitions for the Claude travel extraction agent.

Optimized for minimal API turns: batch operations, combined search+details.
"""

TOOLS = [
    {
        "name": "fetch_url_content",
        "description": (
            "Extract text content, metadata, captions, and comments from a URL. "
            "Dispatches to the appropriate platform extractor (YouTube, Instagram, TikTok, or generic web). "
            "Always call this first to get the raw content from the link."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "The URL to extract content from.",
                },
            },
            "required": ["url"],
        },
    },
    {
        "name": "transcribe_audio",
        "description": (
            "Download and transcribe the audio from a video URL using Whisper. "
            "Use this when the text content doesn't contain enough location info."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "The video URL to download audio from and transcribe.",
                },
            },
            "required": ["url"],
        },
    },
    {
        "name": "analyze_video_frames",
        "description": (
            "Extract key frames from a video and analyze them using Claude Vision "
            "to identify landmarks, signs, restaurant names. Last resort only."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "The video URL to extract frames from.",
                },
                "num_frames": {
                    "type": "integer",
                    "description": "Number of frames to extract (default 5, max 8).",
                    "default": 5,
                },
            },
            "required": ["url"],
        },
    },
    {
        "name": "validate_places",
        "description": (
            "Search and get full details for MULTIPLE places at once via Google Places API. "
            "Pass an array of place queries. Returns coordinates, rating, address, hours, etc. "
            "for each place. Use this to validate all identified places in ONE call."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "places": {
                    "type": "array",
                    "description": "Array of place search queries to validate.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "query": {
                                "type": "string",
                                "description": "Search query (e.g., 'Café Kitsune Louvre Paris').",
                            },
                            "location": {
                                "type": "string",
                                "description": "Location bias (e.g., 'Paris, France').",
                            },
                        },
                        "required": ["query"],
                    },
                },
            },
            "required": ["places"],
        },
    },
    {
        "name": "create_batch_itinerary_items",
        "description": (
            "Create MULTIPLE itinerary items at once in the Rails backend. "
            "Pass an array of items, each with day_plan_id, name, category, etc. "
            "Use this to create ALL items for the entire trip in ONE call. "
            "IMPORTANT: Distribute items across ALL available day_plan_ids."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "trip_id": {
                    "type": "integer",
                    "description": "The trip ID.",
                },
                "items": {
                    "type": "array",
                    "description": "Array of itinerary items to create.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "day_plan_id": {
                                "type": "integer",
                                "description": "The day plan ID (or day number 1-N, will be mapped).",
                            },
                            "name": {
                                "type": "string",
                                "description": "Name of the place.",
                            },
                            "description": {
                                "type": "string",
                                "description": "Description and why it was recommended.",
                            },
                            "category": {
                                "type": "string",
                                "enum": [
                                    "restaurant",
                                    "attraction",
                                    "hotel",
                                    "transport",
                                    "activity",
                                    "shopping",
                                    "cafe",
                                    "nightlife",
                                    "other",
                                ],
                                "description": "Category of the place.",
                            },
                            "time_slot": {
                                "type": "string",
                                "description": "Suggested time (e.g., '09:00', '12:30').",
                            },
                            "duration_minutes": {
                                "type": "integer",
                                "description": "Estimated visit duration in minutes.",
                            },
                            "latitude": {
                                "type": "number",
                                "description": "Latitude from Google Places.",
                            },
                            "longitude": {
                                "type": "number",
                                "description": "Longitude from Google Places.",
                            },
                            "address": {
                                "type": "string",
                                "description": "Full address.",
                            },
                            "google_place_id": {
                                "type": "string",
                                "description": "Google Place ID.",
                            },
                            "google_rating": {
                                "type": "number",
                                "description": "Google rating (1-5).",
                            },
                            "google_reviews_count": {
                                "type": "integer",
                                "description": "Number of Google reviews.",
                            },
                            "operating_hours": {
                                "type": "object",
                                "description": "Opening hours.",
                            },
                            "pricing_info": {
                                "type": "string",
                                "description": "Price level (e.g., '$$', 'Free').",
                            },
                            "phone": {
                                "type": "string",
                                "description": "Phone number.",
                            },
                            "website": {
                                "type": "string",
                                "description": "Website URL.",
                            },
                            "notes": {
                                "type": "string",
                                "description": "Additional tips.",
                            },
                            "source": {
                                "type": "string",
                                "enum": ["link", "ai"],
                                "description": "Set to 'link' if this place was mentioned in the user's submitted content, or 'ai' if you added it from your own knowledge.",
                            },
                            "source_url": {
                                "type": "string",
                                "description": "Original URL where mentioned.",
                            },
                            "vibe_tags": {
                                "type": "array",
                                "items": {"type": "string"},
                                "description": "Vibe tags: instagramavel, hidden_gem, romantico, comida_de_rua, vida_noturna, familiar, cultural, ao_ar_livre, luxo, economico, historico, cafe_trabalho, vista_panoramica.",
                            },
                            "alerts": {
                                "type": "array",
                                "items": {"type": "string"},
                                "description": "Practical alerts like 'Fechado nas segundas-feiras', 'Reserva recomendada'.",
                            },
                            "alternative_group": {
                                "type": "string",
                                "description": "Group ID for alternative options (e.g., 'day1_morning_cafe'). Null for most items.",
                            },
                        },
                        "required": ["day_plan_id", "name", "category"],
                    },
                },
            },
            "required": ["trip_id", "items"],
        },
    },
    {
        "name": "update_link_status",
        "description": (
            "Update the processing status of a link. Call when done."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "trip_id": {
                    "type": "integer",
                    "description": "The trip ID.",
                },
                "link_id": {
                    "type": "integer",
                    "description": "The link ID to update.",
                },
                "status": {
                    "type": "string",
                    "enum": ["processing", "processed", "failed"],
                    "description": "New status.",
                },
                "extracted_data": {
                    "type": "object",
                    "description": "Summary of what was extracted.",
                },
            },
            "required": ["trip_id", "link_id", "status"],
        },
    },
]

# Phase 2 tools: content is already extracted, only need validation + creation
PHASE2_TOOLS = [t for t in TOOLS if t["name"] in ("validate_places", "create_batch_itinerary_items")]
