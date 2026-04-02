import { Link } from "react-router-dom";
import { useLanguage } from "../../i18n/LanguageContext";

// Destination → Unsplash photo mapping (landscape, high quality)
const DESTINATION_IMAGES = {
  paris: "https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=800&h=500&fit=crop&q=80",
  tokyo: "https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=800&h=500&fit=crop&q=80",
  rome: "https://images.unsplash.com/photo-1552832230-c0197dd311b5?w=800&h=500&fit=crop&q=80",
  "new york": "https://images.unsplash.com/photo-1496442226666-8d4d0e62e6e9?w=800&h=500&fit=crop&q=80",
  barcelona: "https://images.unsplash.com/photo-1539037116277-4db20889f2d4?w=800&h=500&fit=crop&q=80",
  bali: "https://images.unsplash.com/photo-1537996194471-e657df975ab4?w=800&h=500&fit=crop&q=80",
  london: "https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=800&h=500&fit=crop&q=80",
  "los angeles": "https://images.unsplash.com/photo-1534190760961-74e8c1c5c3da?w=800&h=500&fit=crop&q=80",
  la: "https://images.unsplash.com/photo-1534190760961-74e8c1c5c3da?w=800&h=500&fit=crop&q=80",
  "las vegas": "https://images.unsplash.com/photo-1605833556294-ea5c7a74f57d?w=800&h=500&fit=crop&q=80",
  vegas: "https://images.unsplash.com/photo-1605833556294-ea5c7a74f57d?w=800&h=500&fit=crop&q=80",
  miami: "https://images.unsplash.com/photo-1533106497176-45ae19e68ba2?w=800&h=500&fit=crop&q=80",
  dubai: "https://images.unsplash.com/photo-1512453979798-5ea266f8880c?w=800&h=500&fit=crop&q=80",
  istanbul: "https://images.unsplash.com/photo-1524231757912-21f4fe3a7200?w=800&h=500&fit=crop&q=80",
  lisbon: "https://images.unsplash.com/photo-1585208798174-6cedd86e019a?w=800&h=500&fit=crop&q=80",
  amsterdam: "https://images.unsplash.com/photo-1534351590666-13e3e96b5017?w=800&h=500&fit=crop&q=80",
  sydney: "https://images.unsplash.com/photo-1506973035872-a4ec16b8e8d9?w=800&h=500&fit=crop&q=80",
  rio: "https://images.unsplash.com/photo-1483729558449-99ef09a8c325?w=800&h=500&fit=crop&q=80",
  "rio de janeiro": "https://images.unsplash.com/photo-1483729558449-99ef09a8c325?w=800&h=500&fit=crop&q=80",
  bangkok: "https://images.unsplash.com/photo-1508009603885-50cf7c579365?w=800&h=500&fit=crop&q=80",
  "buenos aires": "https://images.unsplash.com/photo-1589909202802-8f4aadce1849?w=800&h=500&fit=crop&q=80",
  cairo: "https://images.unsplash.com/photo-1539768942893-daf53e736b68?w=800&h=500&fit=crop&q=80",
  prague: "https://images.unsplash.com/photo-1519677100203-a0e668c92439?w=800&h=500&fit=crop&q=80",
  berlin: "https://images.unsplash.com/photo-1560969184-10fe8719e047?w=800&h=500&fit=crop&q=80",
  madrid: "https://images.unsplash.com/photo-1539037116277-4db20889f2d4?w=800&h=500&fit=crop&q=80",
  singapore: "https://images.unsplash.com/photo-1525625293386-3f8f99389edd?w=800&h=500&fit=crop&q=80",
  "san francisco": "https://images.unsplash.com/photo-1501594907352-04cda38ebc29?w=800&h=500&fit=crop&q=80",
  kyoto: "https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?w=800&h=500&fit=crop&q=80",
  florence: "https://images.unsplash.com/photo-1543429258-3e9a0a0a0b8a?w=800&h=500&fit=crop&q=80",
  hawaii: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800&h=500&fit=crop&q=80",
  cancun: "https://images.unsplash.com/photo-1510097467424-192d713fd8b2?w=800&h=500&fit=crop&q=80",
  mexico: "https://images.unsplash.com/photo-1518638150340-f706e86654de?w=800&h=500&fit=crop&q=80",
};

const DEFAULT_IMAGE = "https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=800&h=500&fit=crop&q=80";

function getDestinationImage(trip) {
  const searchTerms = [
    trip.destination,
    trip.name,
  ].filter(Boolean);

  for (const term of searchTerms) {
    const lower = term.toLowerCase();
    for (const [key, url] of Object.entries(DESTINATION_IMAGES)) {
      if (lower.includes(key)) return url;
    }
  }
  return DEFAULT_IMAGE;
}

export default function TripCard({ trip, onDelete, draggable }) {
  const { t, lang } = useLanguage();
  const pt = lang === "pt-BR";
  const bgImage = getDestinationImage(trip);
  const itemCount = trip.items_count || 0;
  const daysCount = trip.num_days || trip.day_plans_count || 0;

  const handleDragStart = (e) => {
    e.dataTransfer.setData("text/plain", String(trip.id));
    e.dataTransfer.effectAllowed = "move";
    e.currentTarget.style.opacity = "0.5";
  };

  const handleDragEnd = (e) => {
    e.currentTarget.style.opacity = "1";
  };

  return (
    <Link
      to={`/trips/${trip.id}`}
      draggable={draggable}
      onDragStart={draggable ? handleDragStart : undefined}
      onDragEnd={draggable ? handleDragEnd : undefined}
      className={`group relative block rounded-2xl overflow-hidden bg-white shadow-sm hover:shadow-xl transition-all hover:-translate-y-1 border border-gray-100 ${
        draggable ? "cursor-grab active:cursor-grabbing" : ""
      }`}
    >
      {/* Photo — compact aspect ratio */}
      <div className="relative aspect-[16/9] overflow-hidden">
        <img
          src={bgImage}
          alt={trip.destination || trip.name}
          className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />

        {/* Status badge */}
        {trip.status === "active" && (
          <div className="absolute top-3 left-3 bg-emerald-500 text-white text-[9px] font-bold px-2 py-0.5 rounded-full shadow-sm">
            {pt ? "Ativa" : "Active"}
          </div>
        )}

        {/* Delete button — only on hover */}
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (window.confirm(t("tripCard.deleteConfirm"))) onDelete(trip.id);
          }}
          className="absolute top-3 right-3 w-7 h-7 rounded-full bg-black/40 backdrop-blur-sm text-white/70 hover:text-red-400 hover:bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all text-xs"
          title={t("tripCard.delete")}
        >
          ✕
        </button>
      </div>

      {/* Content — clean card section */}
      <div className="p-4">
        <h3 className="text-base font-bold text-gray-900 leading-tight mb-1 truncate">
          {trip.name}
        </h3>
        {trip.destination && trip.destination.toLowerCase() !== trip.name.toLowerCase() && (
          <p className="text-sm text-gray-500 mb-2.5 truncate">{trip.destination}</p>
        )}

        {/* Stats row — Roamy-style badges */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-gray-100 rounded-full px-2.5 py-1">
            <svg className="w-3 h-3 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <span className="text-[11px] font-semibold text-gray-600">{daysCount}d</span>
          </div>
          {itemCount > 0 && (
            <div className="flex items-center gap-1 bg-blue-50 rounded-full px-2.5 py-1">
              <svg className="w-3 h-3 text-blue-400" viewBox="0 0 24 24" fill="currentColor">
                <path fillRule="evenodd" d="M11.54 22.351l.07.04.028.016a.76.76 0 00.723 0l.028-.015.071-.041a16.975 16.975 0 001.144-.742 19.58 19.58 0 002.683-2.282c1.944-1.99 3.963-4.98 3.963-8.827a8.25 8.25 0 00-16.5 0c0 3.846 2.02 6.837 3.963 8.827a19.58 19.58 0 002.682 2.282 16.975 16.975 0 001.145.742z" clipRule="evenodd" />
              </svg>
              <span className="text-[11px] font-semibold text-blue-600">{itemCount} {pt ? "Lugares" : "Spots"}</span>
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}
