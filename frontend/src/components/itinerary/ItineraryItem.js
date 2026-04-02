import { useState } from "react";
import { categoryIcon, formatDuration } from "../../utils/formatters";
import { getSuggestSwap } from "../../api/itineraryItems";
import { useLanguage } from "../../i18n/LanguageContext";

const CATEGORY_LABELS = {
  restaurant: { en: "Restaurant", pt: "Restaurante", color: "bg-orange-100 text-orange-600" },
  attraction: { en: "Attraction", pt: "Atração", color: "bg-blue-100 text-blue-600" },
  hotel: { en: "Hotel", pt: "Hotel", color: "bg-violet-100 text-violet-600" },
  transport: { en: "Transport", pt: "Transporte", color: "bg-gray-100 text-gray-500" },
  activity: { en: "Activity", pt: "Atividade", color: "bg-emerald-100 text-emerald-600" },
  shopping: { en: "Shopping", pt: "Shopping", color: "bg-pink-100 text-pink-600" },
  other: { en: "Place", pt: "Lugar", color: "bg-gray-100 text-gray-500" },
};

export default function ItineraryItem({
  item,
  tripId,
  dayPlanId,
  dayColor,
  dayIndex,
  isSelected,
  isHovered,
  isDragging,
  onClick,
  onHover,
  onDelete,
  onSwap,
}) {
  const { lang } = useLanguage();
  const pt = lang === "pt-BR";
  const [swapSuggestion, setSwapSuggestion] = useState(null);
  const [swapLoading, setSwapLoading] = useState(false);
  const [imgError, setImgError] = useState(false);

  const catInfo = CATEGORY_LABELS[item.category] || CATEGORY_LABELS.other;

  const handleSwapClick = async (e) => {
    e.stopPropagation();
    if (swapSuggestion) {
      setSwapSuggestion(null);
      return;
    }
    setSwapLoading(true);
    try {
      const data = await getSuggestSwap(tripId, dayPlanId, item.id);
      setSwapSuggestion(data.suggestion);
    } catch {
      // ignore
    } finally {
      setSwapLoading(false);
    }
  };

  const handleAcceptSwap = (e) => {
    e.stopPropagation();
    if (swapSuggestion && onSwap) {
      onSwap(item.id, {
        name: swapSuggestion.name,
        category: swapSuggestion.category || item.category,
        latitude: swapSuggestion.latitude,
        longitude: swapSuggestion.longitude,
        address: swapSuggestion.address,
        google_place_id: swapSuggestion.place_id,
        google_rating: swapSuggestion.rating,
        time_slot: item.time_slot,
        duration_minutes: item.duration_minutes,
        position: item.position,
      });
      setSwapSuggestion(null);
    }
  };

  // Photo URL: try photos array first (from Google Places), then photo_url, then photo_reference
  const photoUrl = (item.photos && item.photos.length > 0 && item.photos[0])
    || item.photo_url
    || (item.photo_reference
      ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=120&photo_reference=${item.photo_reference}&key=${process.env.REACT_APP_GOOGLE_MAPS_API_KEY}`
      : null);
  const hasPhoto = !!photoUrl && !imgError;

  return (
    <div>
      <div
        id={`item-${item.id}`}
        onClick={onClick}
        onMouseEnter={() => onHover(true)}
        onMouseLeave={() => onHover(false)}
        className={`group relative rounded-xl overflow-hidden cursor-pointer transition-all duration-200 ${
          isDragging
            ? "ring-2 ring-coral-400 shadow-lg shadow-coral-500/20 rotate-1 scale-[1.02]"
            : isSelected
            ? "ring-2 ring-coral-500 shadow-md"
            : isHovered
            ? "ring-1 ring-gray-300 shadow-sm"
            : "hover:shadow-sm"
        } ${item.source === "link" ? "bg-blue-50/50" : "bg-white"}`}
        style={{ borderLeft: `3px solid ${dayColor}` }}
      >
        <div className="flex items-stretch">
          {/* Photo thumbnail or numbered marker */}
          {hasPhoto ? (
            <div className="w-16 h-16 flex-shrink-0 relative overflow-hidden">
              <img
                src={photoUrl}
                alt=""
                className="w-full h-full object-cover"
                onError={() => setImgError(true)}
                loading="lazy"
              />
              {/* Position number overlay */}
              {dayIndex != null && (
                <div
                  className="absolute top-0.5 left-0.5 w-4.5 h-4.5 rounded-full flex items-center justify-center text-white text-[8px] font-bold shadow"
                  style={{ backgroundColor: dayColor, width: 18, height: 18 }}
                >
                  {dayIndex}
                </div>
              )}
            </div>
          ) : (
            <div className="w-11 flex-shrink-0 flex items-center justify-center">
              {dayIndex != null ? (
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-sm"
                  style={{ backgroundColor: dayColor }}
                >
                  {dayIndex}
                </div>
              ) : (
                <span className="text-base">{categoryIcon(item.category)}</span>
              )}
            </div>
          )}

          {/* Content */}
          <div className="flex-1 min-w-0 px-3 py-2">
            {/* Row 1: Name + badges */}
            <div className="flex items-center gap-1.5">
              <span className="text-sm">{categoryIcon(item.category)}</span>
              <h4 className="font-semibold text-sm text-gray-900 truncate">
                {item.name}
              </h4>
            </div>

            {/* Row 2: Category + rating + meta */}
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${catInfo.color}`}>
                {pt ? catInfo.pt : catInfo.en}
              </span>
              {item.google_rating && (
                <span className="flex items-center gap-0.5 text-[11px] text-gray-500">
                  <span className="text-yellow-500">★</span>
                  <span className="font-medium">{item.google_rating}</span>
                </span>
              )}
              {item.source === "link" && (
                <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-600">
                  📸 {pt ? "Do vídeo" : "From video"}
                </span>
              )}
              {item.duration_minutes && (
                <span className="text-[10px] text-gray-400">
                  ⏱ {formatDuration(item.duration_minutes)}
                </span>
              )}
              {item.time_slot && (
                <span className="text-[10px] text-gray-400">
                  {item.time_slot}
                </span>
              )}
            </div>
          </div>

          {/* Action buttons — visible only on hover */}
          <div className="flex items-center gap-1 px-2 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
            <button
              onClick={handleSwapClick}
              disabled={swapLoading}
              className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${
                swapSuggestion ? "bg-coral-50 text-coral-500" : "text-gray-400 hover:bg-gray-100 hover:text-coral-500"
              }`}
              title={pt ? "Outra opção?" : "Another option?"}
            >
              {swapLoading ? (
                <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeDasharray="30 70" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                  <path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H4.598a.75.75 0 00-.75.75v3.634a.75.75 0 001.5 0v-2.033a7 7 0 0011.713-3.13.75.75 0 00-1.449-.394l-.3.018zM4.688 8.576a5.5 5.5 0 019.201-2.466l.312.311H11.77a.75.75 0 000 1.5h3.634a.75.75 0 00.75-.75V3.537a.75.75 0 00-1.5 0v2.033A7 7 0 003.239 8.97a.75.75 0 001.449.394l.3-.018z" clipRule="evenodd" />
                </svg>
              )}
            </button>

            {(item.google_place_id || item.latitude) && (
              <a
                href={
                  item.google_place_id
                    ? `https://www.google.com/maps/place/?q=place_id:${item.google_place_id}`
                    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.name)}`
                }
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-coral-500 transition-colors"
                title="Google Maps"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                  <path fillRule="evenodd" d="M9.69 18.933l.003.001C9.89 19.02 10 19 10 19s.11.02.308-.066l.002-.001.006-.003.018-.008a5.741 5.741 0 00.281-.14c.186-.096.446-.24.757-.433.62-.384 1.445-.966 2.274-1.765C15.302 14.988 17 12.493 17 9A7 7 0 103 9c0 3.492 1.698 5.988 3.355 7.584a13.731 13.731 0 002.273 1.765 11.842 11.842 0 00.976.544l.062.029.018.008.006.003zM10 11.25a2.25 2.25 0 100-4.5 2.25 2.25 0 000 4.5z" clipRule="evenodd" />
                </svg>
              </a>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-300 hover:bg-red-50 hover:text-red-400 text-xs transition-colors"
            >
              ✕
            </button>
          </div>
        </div>
      </div>

      {/* Swap suggestion card */}
      {swapSuggestion && (
        <div className="ml-4 mt-1.5 mb-1 p-3 bg-gradient-to-r from-coral-50 to-orange-50 border border-coral-200 rounded-xl shadow-sm" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs">💡</span>
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
              {pt ? "Sugestão" : "Suggestion"}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h5 className="text-sm font-semibold text-gray-800 truncate">{swapSuggestion.name}</h5>
                {swapSuggestion.rating && (
                  <span className="flex items-center gap-0.5 text-xs">
                    <span className="text-yellow-500">★</span>
                    <span className="text-gray-600 font-medium">{swapSuggestion.rating}</span>
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-2">
                <button
                  onClick={handleAcceptSwap}
                  className="px-3 py-1.5 bg-coral-500 hover:bg-coral-400 text-white text-xs font-semibold rounded-lg transition-colors shadow-sm"
                >
                  {pt ? "Trocar" : "Swap"}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setSwapSuggestion(null); }}
                  className="px-3 py-1.5 text-gray-400 hover:text-gray-700 text-xs font-medium transition-colors"
                >
                  {pt ? "Manter" : "Keep"}
                </button>
                <button
                  onClick={handleSwapClick}
                  className="px-2 py-1.5 text-gray-400 hover:text-coral-500 text-xs transition-colors"
                  title={pt ? "Outra sugestão" : "Another suggestion"}
                >
                  ↻
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
