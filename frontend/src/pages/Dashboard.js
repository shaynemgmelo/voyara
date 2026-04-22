import { useState, useEffect } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import useTrips from "../hooks/useTrips";
import TripCard from "../components/trips/TripCard";
import { useLanguage } from "../i18n/LanguageContext";

export default function Dashboard() {
  const { trips, loading, error, deleteTrip } = useTrips();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t, lang } = useLanguage();

  // Persisted order: which trip ID is pinned as hero
  const [pinnedTripId, setPinnedTripId] = useState(() => {
    const saved = localStorage.getItem("mapass_pinned_trip");
    return saved ? Number(saved) : null;
  });

  // Drag state
  const [dragOverHero, setDragOverHero] = useState(false);

  // ?new=1 → forward straight to the unified trip-create form. The old
  // dashboard "New Trip" modal that did upfront link analysis is gone —
  // extraction is now deferred until the user clicks Generate on the
  // /trips/new form (see Phase 2 of the deferred-extraction redesign).
  useEffect(() => {
    if (searchParams.get("new") === "1") {
      setSearchParams({}, { replace: true });
      navigate("/trips/new");
    }
  }, [searchParams, setSearchParams, navigate]);

  const pt = lang === "pt-BR";

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-20 text-center text-gray-400">
        {t("dashboard.loading")}
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-20 text-center text-red-500">
        {t("dashboard.error")} {error}
      </div>
    );
  }

  // Determine hero trip: pinned first, then active, then first
  const heroTrip = trips.find((t) => t.id === pinnedTripId)
    || trips.find((t) => t.status === "active")
    || trips[0];
  const otherTrips = trips.filter((t) => t.id !== heroTrip?.id);

  const handlePinTrip = (tripId) => {
    setPinnedTripId(tripId);
    localStorage.setItem("mapass_pinned_trip", String(tripId));
  };

  // Drag handlers for hero zone
  const handleDragOverHero = (e) => {
    e.preventDefault();
    setDragOverHero(true);
  };

  const handleDragLeaveHero = () => {
    setDragOverHero(false);
  };

  const handleDropOnHero = (e) => {
    e.preventDefault();
    setDragOverHero(false);
    const tripId = Number(e.dataTransfer.getData("text/plain"));
    if (tripId && tripId !== heroTrip?.id) {
      handlePinTrip(tripId);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {trips.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-6xl mb-6">🌍</div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            {pt ? "Para onde vamos?" : "Where are we going?"}
          </h2>
          <p className="text-gray-500 mb-8 max-w-md mx-auto">
            {pt
              ? "Comece colando um link de viagem ou crie sua primeira viagem."
              : "Start by pasting a travel link or create your first trip."}
          </p>
          <Link
            to="/trips/new"
            className="inline-block bg-coral-500 hover:bg-coral-600 text-white font-semibold px-8 py-3 rounded-xl transition-colors"
          >
            {t("dashboard.createFirst")}
          </Link>
        </div>
      ) : (
        <>
          {/* Hero trip */}
          {heroTrip && (
            <div className="mb-10">
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
                {pt ? "Sua viagem" : "Your trip"}
              </h2>

              {/* Hero drop zone */}
              <Link
                to={`/trips/${heroTrip.id}`}
                className={`group block relative rounded-2xl overflow-hidden shadow-lg hover:shadow-2xl transition-all aspect-[21/9] ${
                  dragOverHero ? "ring-4 ring-coral-400 ring-offset-2 scale-[1.01]" : ""
                }`}
                onDragOver={handleDragOverHero}
                onDragLeave={handleDragLeaveHero}
                onDrop={handleDropOnHero}
              >
                <img
                  src={getHeroImage(heroTrip)}
                  alt={heroTrip.destination || heroTrip.name}
                  className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

                {/* Drop hint overlay */}
                {dragOverHero && (
                  <div className="absolute inset-0 bg-coral-500/20 backdrop-blur-[2px] flex items-center justify-center z-10">
                    <div className="bg-white/90 backdrop-blur-md rounded-xl px-6 py-3 shadow-lg">
                      <p className="text-coral-600 font-bold text-sm">
                        {pt ? "Solte aqui para destacar" : "Drop here to pin"}
                      </p>
                    </div>
                  </div>
                )}

                <div className="absolute bottom-0 left-0 right-0 p-8">
                  <h3 className="text-white text-3xl font-bold mb-1">{heroTrip.name}</h3>
                  {heroTrip.destination && (
                    <p className="text-white/70 text-base mb-3">{heroTrip.destination}</p>
                  )}
                  <div className="flex items-center gap-4 text-white/60 text-sm">
                    <span>📅 {heroTrip.num_days || heroTrip.day_plans_count} {t("tripCard.days")}</span>
                    {(heroTrip.items_count || 0) > 0 && (
                      <span>📍 {heroTrip.items_count} {t("tripCard.places")}</span>
                    )}
                  </div>
                </div>
                <div className="absolute top-5 right-5 bg-white/20 backdrop-blur-md text-white text-xs font-bold px-4 py-1.5 rounded-full">
                  {pt ? "Continuar planejando →" : "Continue planning →"}
                </div>
              </Link>
            </div>
          )}

          {/* Other trips — draggable cards */}
          {otherTrips.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-1">
                {pt ? "Outras viagens" : "Other trips"}
              </h2>
              <p className="text-xs text-gray-300 mb-4">
                {pt ? "Arraste para cima para destacar" : "Drag up to pin as main trip"}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {otherTrips.map((trip) => (
                  <TripCard key={trip.id} trip={trip} onDelete={deleteTrip} draggable />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const DESTINATION_IMAGES = {
  paris: "https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=1200&h=600&fit=crop&q=80",
  tokyo: "https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=1200&h=600&fit=crop&q=80",
  rome: "https://images.unsplash.com/photo-1552832230-c0197dd311b5?w=1200&h=600&fit=crop&q=80",
  "new york": "https://images.unsplash.com/photo-1496442226666-8d4d0e62e6e9?w=1200&h=600&fit=crop&q=80",
  barcelona: "https://images.unsplash.com/photo-1539037116277-4db20889f2d4?w=1200&h=600&fit=crop&q=80",
  bali: "https://images.unsplash.com/photo-1537996194471-e657df975ab4?w=1200&h=600&fit=crop&q=80",
  london: "https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=1200&h=600&fit=crop&q=80",
  "los angeles": "https://images.unsplash.com/photo-1534190760961-74e8c1c5c3da?w=1200&h=600&fit=crop&q=80",
  la: "https://images.unsplash.com/photo-1534190760961-74e8c1c5c3da?w=1200&h=600&fit=crop&q=80",
  "las vegas": "https://images.unsplash.com/photo-1605833556294-ea5c7a74f57d?w=1200&h=600&fit=crop&q=80",
  vegas: "https://images.unsplash.com/photo-1605833556294-ea5c7a74f57d?w=1200&h=600&fit=crop&q=80",
  miami: "https://images.unsplash.com/photo-1533106497176-45ae19e68ba2?w=1200&h=600&fit=crop&q=80",
  dubai: "https://images.unsplash.com/photo-1512453979798-5ea266f8880c?w=1200&h=600&fit=crop&q=80",
  lisbon: "https://images.unsplash.com/photo-1585208798174-6cedd86e019a?w=1200&h=600&fit=crop&q=80",
  amsterdam: "https://images.unsplash.com/photo-1534351590666-13e3e96b5017?w=1200&h=600&fit=crop&q=80",
  rio: "https://images.unsplash.com/photo-1483729558449-99ef09a8c325?w=1200&h=600&fit=crop&q=80",
  "rio de janeiro": "https://images.unsplash.com/photo-1483729558449-99ef09a8c325?w=1200&h=600&fit=crop&q=80",
  hawaii: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1200&h=600&fit=crop&q=80",
};

const DEFAULT_HERO = "https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=1200&h=600&fit=crop&q=80";

function getHeroImage(trip) {
  const terms = [trip.destination, trip.name].filter(Boolean);
  for (const term of terms) {
    const lower = term.toLowerCase();
    for (const [key, url] of Object.entries(DESTINATION_IMAGES)) {
      if (lower.includes(key)) return url;
    }
  }
  return DEFAULT_HERO;
}
