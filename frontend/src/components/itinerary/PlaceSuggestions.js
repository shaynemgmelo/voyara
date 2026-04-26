import { useState, useEffect } from "react";
import { getSmartSuggestions } from "../../api/dayPlans";
import { useLanguage } from "../../i18n/LanguageContext";
import { categoryIcon } from "../../utils/formatters";
import { buildItineraryItemPayload } from "../../utils/itineraryItemPayload";

export default function PlaceSuggestions({ tripId, dayPlanId, onAdd, onManualAdd, onClose }) {
  const { t } = useLanguage();
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addingId, setAddingId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getSmartSuggestions(tripId, dayPlanId)
      .then((data) => {
        if (!cancelled) setSuggestions(data.suggestions || []);
      })
      .catch(() => {
        if (!cancelled) setSuggestions([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [tripId, dayPlanId]);

  const handleAdd = async (suggestion) => {
    setAddingId(suggestion.place_id);
    try {
      // Map Google Places API field names to our internal convention so
      // buildItineraryItemPayload can normalise them correctly.
      await onAdd(buildItineraryItemPayload(
        {
          ...suggestion,
          // place_id → google_place_id (builder passes through google_place_id)
          google_place_id: suggestion.place_id,
          // photo → photo_url (builder picks up photo_url when photos is absent)
          photo_url: suggestion.photo,
        },
        { origin: "ai_suggested" },
      ));
      // Remove from list after adding
      setSuggestions((prev) => prev.filter((s) => s.place_id !== suggestion.place_id));
    } finally {
      setAddingId(null);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-sm w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
          <h2 className="text-lg font-bold text-gray-900">{t("suggestions.title")}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-900 text-xl">
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="flex items-center gap-3 text-gray-500">
                <div className="w-5 h-5 border-2 border-gray-400 border-t-coral-400 rounded-full animate-spin" />
                <span className="text-sm">{t("suggestions.loading")}</span>
              </div>
            </div>
          )}

          {!loading && suggestions.length === 0 && (
            <div className="text-center py-12 text-gray-400 text-sm">
              {t("suggestions.noSuggestions")}
            </div>
          )}

          {!loading && suggestions.map((s) => (
            <div
              key={s.place_id}
              className="flex items-center gap-3 bg-gray-100 hover:bg-gray-200 rounded-lg p-3 transition-colors group"
            >
              {/* Photo */}
              {s.photo ? (
                <img
                  src={s.photo}
                  alt={s.name}
                  className="w-14 h-14 rounded-lg object-cover flex-shrink-0"
                  loading="lazy"
                />
              ) : (
                <div className="w-14 h-14 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0 text-2xl">
                  {categoryIcon(s.category)}
                </div>
              )}

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{s.name}</p>
                <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
                  {s.rating && (
                    <span className="text-yellow-400">★ {s.rating}</span>
                  )}
                  <span className="capitalize px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
                    {s.category}
                  </span>
                  {s.distance && (
                    <span>
                      {s.distance < 1000
                        ? `${s.distance}m`
                        : `${(s.distance / 1000).toFixed(1)}km`}
                    </span>
                  )}
                </div>
                {s.address && (
                  <p className="text-xs text-gray-400 truncate mt-0.5">{s.address}</p>
                )}
              </div>

              {/* Add button */}
              <button
                onClick={() => handleAdd(s)}
                disabled={addingId === s.place_id}
                className="flex-shrink-0 px-3 py-1.5 bg-coral-500 hover:bg-coral-400 disabled:bg-coral-700 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
              >
                {addingId === s.place_id ? "..." : t("suggestions.addThis")}
              </button>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-200 flex gap-3 flex-shrink-0">
          <button
            onClick={onManualAdd}
            className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
              <path d="M8.75 3.75a.75.75 0 00-1.5 0v3.5h-3.5a.75.75 0 000 1.5h3.5v3.5a.75.75 0 001.5 0v-3.5h3.5a.75.75 0 000-1.5h-3.5v-3.5z" />
            </svg>
            {t("suggestions.addManually")}
          </button>
        </div>
      </div>
    </div>
  );
}
