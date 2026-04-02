import { useState, useEffect, useRef, useCallback } from "react";
import { autocomplete, getPlaceDetails } from "../../api/googlePlaces";
import { useLanguage } from "../../i18n/LanguageContext";

export default function HotelMapInput({
  lodgings = [],
  onLodgingCreated,
  onLodgingRemoved,
}) {
  const { t } = useLanguage();
  const [query, setQuery] = useState("");
  const [predictions, setPredictions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const debounceRef = useRef(null);
  const wrapperRef = useRef(null);

  // Find first lodging with coordinates (the "active" hotel on map)
  const activeHotel = lodgings.find((l) => l.latitude && l.longitude);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleInputChange = useCallback((value) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (value.trim().length < 2) {
      setPredictions([]);
      setShowDropdown(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await autocomplete(value, "lodging");
        const preds = res.predictions || [];
        setPredictions(preds);
        setShowDropdown(preds.length > 0);
      } catch {
        setPredictions([]);
      } finally {
        setLoading(false);
      }
    }, 300);
  }, []);

  const handleSelect = async (prediction) => {
    setShowDropdown(false);
    setQuery("");
    setPredictions([]);
    setSaving(true);

    try {
      const res = await getPlaceDetails(prediction.place_id);
      const place = res.result;
      if (!place) return;

      const lodgingData = {
        name: place.name || prediction.structured_formatting?.main_text || prediction.description,
        address: place.formatted_address || "",
        latitude: place.geometry?.location?.lat,
        longitude: place.geometry?.location?.lng,
        google_place_id: prediction.place_id,
        google_rating: place.rating || null,
        phone: place.formatted_phone_number || null,
        website: place.website || null,
      };

      if (onLodgingCreated) {
        await onLodgingCreated(lodgingData);
      }
    } catch (err) {
      console.error("Failed to save hotel:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = () => {
    if (activeHotel && onLodgingRemoved) {
      onLodgingRemoved(activeHotel.id);
    }
  };

  // Hotel already selected — show saved hotel
  if (activeHotel) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 bg-gray-900 text-white">
        <div className="flex items-center justify-center w-9 h-9 rounded-full bg-white/15 flex-shrink-0">
          <span className="text-lg">🏨</span>
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-sm font-semibold truncate block">
            {activeHotel.name}
          </span>
          <div className="flex items-center gap-2 mt-0.5">
            {activeHotel.google_rating && (
              <span className="text-xs text-yellow-400">
                {"★"} {activeHotel.google_rating}
              </span>
            )}
            {activeHotel.address && (
              <span className="text-xs text-gray-400 truncate">
                {activeHotel.address.split(",")[0]}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={handleRemove}
          className="text-gray-500 hover:text-red-400 text-sm transition-colors flex-shrink-0 px-1"
          title={t("hotelInput.change")}
        >
          ✕
        </button>
      </div>
    );
  }

  // No hotel — show prominent search input
  return (
    <div ref={wrapperRef} className="relative">
      <div className="flex items-center gap-3 px-4 py-3.5 bg-gray-900">
        <div className="flex items-center justify-center w-9 h-9 rounded-full bg-white/15 flex-shrink-0">
          <span className="text-lg">🏨</span>
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => handleInputChange(e.target.value)}
          placeholder={t("hotelInput.placeholder")}
          className="flex-1 text-sm bg-transparent outline-none text-white placeholder-gray-400 font-medium"
          disabled={saving}
        />
        {(loading || saving) && (
          <svg
            className="w-5 h-5 animate-spin text-gray-400 flex-shrink-0"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="2"
              strokeDasharray="30 70"
            />
          </svg>
        )}
      </div>

      {/* Autocomplete dropdown */}
      {showDropdown && predictions.length > 0 && (
        <div className="absolute top-full left-0 right-0 z-50 bg-gray-800 border border-gray-700 rounded-b-lg shadow-2xl max-h-60 overflow-y-auto">
          {predictions.map((pred) => (
            <button
              key={pred.place_id}
              onClick={() => handleSelect(pred)}
              className="w-full text-left px-4 py-3 hover:bg-gray-700 transition-colors border-b border-gray-700/50 last:border-0"
            >
              <div className="text-sm font-medium text-white truncate">
                {pred.structured_formatting?.main_text || pred.description}
              </div>
              {pred.structured_formatting?.secondary_text && (
                <div className="text-xs text-gray-400 truncate mt-0.5">
                  {pred.structured_formatting.secondary_text}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
