import { useLanguage } from "../../i18n/LanguageContext";

export default function PlaceInfoCard({ place }) {
  const { t } = useLanguage();

  const typeLabels = {
    restaurant: "🍽️",
    cafe: "☕",
    lodging: "🏨",
    tourist_attraction: "📸",
    park: "🌳",
    museum: "🏛️",
    shopping_mall: "🛍️",
    bar: "🍸",
    night_club: "🎶",
  };

  // Pick an emoji based on the types
  const mainType = (place.types || []).find(t => typeLabels[t]) || "";
  const emoji = typeLabels[mainType] || "📍";

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow overflow-hidden">
      {/* Photos */}
      {place.photos && place.photos.length > 0 && (
        <div className="h-40 overflow-hidden">
          <img
            src={place.photos[0]}
            alt={place.name}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        </div>
      )}

      <div className="p-4">
        {/* Name + type */}
        <div className="flex items-start gap-2 mb-2">
          <span className="text-lg flex-shrink-0">{emoji}</span>
          <div className="min-w-0">
            <h3 className="font-semibold text-gray-900 text-sm leading-tight">{place.name}</h3>
            {place.address && (
              <p className="text-xs text-gray-400 mt-0.5 truncate">{place.address}</p>
            )}
          </div>
        </div>

        {/* Rating + pricing */}
        <div className="flex items-center gap-3 mb-3">
          {place.rating && (
            <div className="flex items-center gap-1">
              <span className="text-yellow-500 text-xs">★</span>
              <span className="text-sm font-semibold text-gray-700">{place.rating}</span>
              {place.reviews_count && (
                <span className="text-xs text-gray-400">({place.reviews_count.toLocaleString()})</span>
              )}
            </div>
          )}
          {place.pricing && (
            <span className="text-xs text-gray-500 font-medium">{place.pricing}</span>
          )}
        </div>

        {/* Operating hours */}
        {place.operating_hours && Object.keys(place.operating_hours).length > 0 && (
          <div className="mb-3">
            <details className="group">
              <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700 flex items-center gap-1">
                <span>🕐</span> {t("placeCard.hours")}
                <svg className="w-3 h-3 group-open:rotate-180 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </summary>
              <div className="mt-1.5 space-y-0.5">
                {Object.entries(place.operating_hours).map(([day, hours]) => (
                  <div key={day} className="flex justify-between text-xs">
                    <span className="text-gray-500">{day}</span>
                    <span className="text-gray-700">{hours}</span>
                  </div>
                ))}
              </div>
            </details>
          </div>
        )}

        {/* Action links */}
        <div className="flex items-center gap-2 flex-wrap">
          {place.google_maps_url && (
            <a
              href={place.google_maps_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium"
            >
              📍 {t("placeCard.viewOnMaps")}
            </a>
          )}
          {place.website && (
            <a
              href={place.website}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium"
            >
              🌐 {t("placeCard.website")}
            </a>
          )}
          {place.phone && (
            <a
              href={`tel:${place.phone}`}
              className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium"
            >
              📞 {place.phone}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
