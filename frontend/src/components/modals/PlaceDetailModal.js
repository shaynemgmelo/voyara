import { useEffect, useState } from "react";
import { useLanguage } from "../../i18n/LanguageContext";

/**
 * Rich detail card for a place — opened from either:
 *   - a card click in ExtractedPlacesPanel (the panel side)
 *   - a pin click in TripMap (the map side)
 *
 * Layout adapts to viewport:
 *   - Mobile (< sm): bottom sheet sliding up from the bottom edge,
 *     full-width with rounded top corners, drag handle at top.
 *     Inspired by Wanderlog / Atlas Obscura style detail sheets.
 *   - Desktop (≥ sm): centered modal card, max-w-md, slight scale-in.
 *
 * Content sections (in order of importance):
 *   1. Photo header — full bleed, with overlaid title + close button.
 *   2. Quick facts row — rating, reviews, category, price, hours-now.
 *   3. About this place — editorial_summary (Google's curated blurb).
 *   4. Notes from Community — aggregated creator_notes from EVERY
 *      video that mentioned this place, each with its source link.
 *   5. Address + mini map.
 *   6. Hours (collapsed-by-default to save space).
 *   7. Phone + website.
 *   8. Top reviews from Google.
 *   9. Quick-add to a day (when in manual mode + has dayPlans).
 *  10. Footer actions: Open in Google Maps, Watch source video.
 *
 * Props:
 *   place           — the places_mentioned entry (rich, post-enrichment)
 *   sourceUrl       — override for the video URL (defaults to place.source_url)
 *   onClose         — closes the modal
 *   dayPlans        — optional: enables "Add to day X" buttons
 *   onAddToDay      — async (dayPlanId) => void
 *   alreadyOnDayId  — optional: highlights the day where this place lives
 */
export default function PlaceDetailModal({
  place,
  sourceUrl,
  onClose,
  dayPlans = null,
  onAddToDay = null,
  alreadyOnDayId = null,
}) {
  const { lang } = useLanguage();
  const pt = lang === "pt-BR";
  const [adding, setAdding] = useState(false);
  const [addedDayId, setAddedDayId] = useState(null);
  const [hoursExpanded, setHoursExpanded] = useState(false);
  const [sourcesExpanded, setSourcesExpanded] = useState(false);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!place) return null;

  const url = sourceUrl || place.source_url;
  const hasGeo = place.latitude != null && place.longitude != null;
  const photo = place.photo_url;
  const cat = place.category || "place";
  const rating = place.rating;
  const reviewsCount = place.reviews_count;
  const address = place.address;
  const pricing = place.pricing;
  const editorialSummary = (place.editorial_summary || "").trim();
  const creatorNote = (place.creator_note || "").trim();
  const topReviews = Array.isArray(place.top_reviews) ? place.top_reviews : [];
  const isExperience = place.kind === "experience";
  const operatingHours = place.operating_hours || {};
  const hasHours = Object.keys(operatingHours).length > 0;

  // Build the unified community_notes list. The backend now persists
  // a `community_notes: [{note, source_url, source_platform}]` array
  // when a place is mentioned in multiple videos. For trips/places
  // built before that field existed, fall back to the single
  // `creator_note` string with the place's own source_url.
  const communityNotes = (() => {
    const explicit = Array.isArray(place.community_notes)
      ? place.community_notes.filter((n) => n && (n.note || "").trim())
      : [];
    if (explicit.length > 0) return explicit;
    if (creatorNote) {
      return [{
        note: creatorNote,
        source_url: url,
        source_platform: detectPlatform(url),
      }];
    }
    return [];
  })();

  // De-dupe sources for the "Show sources • N" pill.
  const uniqueSources = Array.from(
    new Set(
      communityNotes
        .map((n) => n.source_url)
        .filter(Boolean),
    ),
  );

  const gmapsUrl =
    place.google_maps_url
    || (place.google_place_id
      ? `https://www.google.com/maps/place/?q=place_id:${place.google_place_id}`
      : null);

  const mapsEmbedUrl = (() => {
    const key = process.env.REACT_APP_GOOGLE_MAPS_API_KEY;
    if (!key) return null;
    if (place.google_place_id) {
      return `https://www.google.com/maps/embed/v1/place?key=${key}&q=place_id:${place.google_place_id}&zoom=15`;
    }
    if (hasGeo) {
      return `https://www.google.com/maps/embed/v1/place?key=${key}&q=${place.latitude},${place.longitude}&zoom=15`;
    }
    return null;
  })();

  const handleAddToDay = async (dayPlanId) => {
    if (!onAddToDay || adding) return;
    setAdding(true);
    try {
      await onAddToDay(dayPlanId);
      setAddedDayId(dayPlanId);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[place-detail] add to day failed:", e);
    } finally {
      setAdding(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4"
      onClick={onClose}
    >
      <div
        // Mobile: full-width bottom sheet pinned to the bottom of the
        // screen with rounded-t corners + slide-up animation.
        // Desktop: centered card with rounded corners on all sides.
        className="bg-white w-full sm:max-w-md sm:w-full sm:rounded-2xl rounded-t-3xl shadow-2xl overflow-hidden max-h-[92vh] sm:max-h-[90vh] flex flex-col animate-[slideUp_0.2s_ease-out] sm:animate-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Mobile drag handle — visual cue this is a bottom sheet you
            could swipe down to dismiss (touch swipe support not wired
            yet but the visual affords the gesture). Hidden on desktop. */}
        <div className="sm:hidden flex justify-center py-2 flex-shrink-0">
          <div className="w-10 h-1 rounded-full bg-gray-300" />
        </div>

        {/* Photo header — full-bleed when available, gradient placeholder
            otherwise. The close button overlays the photo on desktop;
            on mobile it's also there but the drag handle reinforces
            "swipe down to close". */}
        {photo ? (
          <div className="relative h-44 sm:h-48 w-full bg-gray-100 flex-shrink-0">
            <img
              src={photo}
              alt=""
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent pointer-events-none" />
            <button
              type="button"
              onClick={onClose}
              className="absolute top-3 right-3 w-9 h-9 rounded-full bg-white/90 hover:bg-white text-gray-700 flex items-center justify-center shadow-md backdrop-blur"
              aria-label={pt ? "Fechar" : "Close"}
            >
              ✕
            </button>
            {/* Title overlay on photo */}
            <div className="absolute bottom-0 left-0 right-0 p-4 text-white">
              <h2 className="text-xl font-bold leading-tight drop-shadow-md">
                {place.name}
              </h2>
            </div>
          </div>
        ) : (
          <div className="relative h-32 w-full bg-gradient-to-br from-amber-100 to-orange-100 flex items-center justify-center text-5xl flex-shrink-0">
            <span aria-hidden>{CATEGORY_EMOJI[cat] || "📍"}</span>
            <button
              type="button"
              onClick={onClose}
              className="absolute top-3 right-3 w-9 h-9 rounded-full bg-white/90 hover:bg-white text-gray-700 flex items-center justify-center shadow-md"
              aria-label={pt ? "Fechar" : "Close"}
            >
              ✕
            </button>
            <div className="absolute bottom-0 left-0 right-0 p-4">
              <h2 className="text-xl font-bold text-gray-900 leading-tight">
                {place.name}
              </h2>
            </div>
          </div>
        )}

        <div className="p-4 sm:p-5 space-y-4 overflow-y-auto overscroll-contain">
          {/* Quick facts row — rating, category, price */}
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-gray-100 text-gray-700 font-semibold">
              {CATEGORY_EMOJI[cat] || "📍"} {translateCategory(cat, pt)}
            </span>
            {rating != null && (
              <span className="inline-flex items-center gap-1 text-amber-600 font-bold">
                ★ {Number(rating).toFixed(1)}
                {reviewsCount > 0 && (
                  <span className="text-gray-400 font-normal">
                    ({reviewsCount.toLocaleString()})
                  </span>
                )}
              </span>
            )}
            {pricing && (
              <span className="text-emerald-600 font-bold">{pricing}</span>
            )}
            {isExperience && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 font-semibold text-[11px]">
                ✨ {pt ? "Experiência" : "Experience"}
              </span>
            )}
          </div>

          {/* About this place — Google editorial summary */}
          {editorialSummary && (
            <Card title={pt ? "Sobre este lugar" : "About this place"} accent="amber">
              <p className="text-sm text-gray-800 leading-relaxed">
                {editorialSummary}
              </p>
            </Card>
          )}

          {/* Notes from Community — aggregated creator notes from every
              video that mentioned this place. The Wanderlog-inspired
              section the user explicitly asked for. Each note is a
              bullet with the source video link inline. */}
          {communityNotes.length > 0 && (
            <Card title={pt ? "Notas da Comunidade" : "Notes from the Community"} accent="coral">
              <ul className="space-y-2">
                {communityNotes.map((n, i) => (
                  <li key={i} className="flex gap-2 text-sm text-gray-800 leading-relaxed">
                    <span className="text-coral-400 flex-shrink-0 mt-0.5">•</span>
                    <div className="flex-1 min-w-0">
                      <span>{n.note}</span>
                      {n.source_url && (
                        <a
                          href={n.source_url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="ml-1.5 inline-flex items-center text-coral-600 hover:text-coral-700 text-[11px] align-middle"
                          title={n.source_url}
                        >
                          {sourceIconForUrl(n.source_url)}
                        </a>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              {/* Show sources pill — Wanderlog-style "Show sources • N" */}
              {uniqueSources.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSourcesExpanded(!sourcesExpanded)}
                  className="mt-3 inline-flex items-center gap-2 text-[11px] font-semibold text-coral-700 hover:text-coral-800"
                >
                  <span>
                    {sourcesExpanded
                      ? (pt ? "Ocultar fontes" : "Hide sources")
                      : (pt ? `Mostrar fontes • ${uniqueSources.length}` : `Show sources • ${uniqueSources.length}`)}
                  </span>
                  <span className={`transition-transform ${sourcesExpanded ? "rotate-180" : ""}`}>▾</span>
                </button>
              )}
              {sourcesExpanded && uniqueSources.length > 0 && (
                <div className="mt-2 space-y-1.5 border-t border-coral-100 pt-2">
                  {uniqueSources.map((s, i) => (
                    <a
                      key={i}
                      href={s}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2 text-xs text-gray-600 hover:text-coral-600 truncate"
                    >
                      <span className="text-base flex-shrink-0">{sourceIconForUrl(s)}</span>
                      <span className="truncate">{shortSourceLabel(s)}</span>
                    </a>
                  ))}
                </div>
              )}
            </Card>
          )}

          {/* Friendly fallback when we have NEITHER editorial nor notes */}
          {!editorialSummary && communityNotes.length === 0 && (
            <div className="rounded-xl bg-gray-50 border border-gray-100 p-3 text-xs text-gray-600 leading-relaxed">
              {isExperience
                ? (pt
                    ? "Essa experiência foi citada no vídeo de origem. Veja o vídeo para detalhes — o que recomendou, melhor horário, dicas práticas."
                    : "This experience was mentioned in the source video. Watch it for details — recommendations, best time, practical tips.")
                : (pt
                    ? "Sem descrição editorial pra esse lugar ainda. Veja o vídeo de origem ou abra no Google Maps pra reviews completos."
                    : "No editorial description yet. Check the source video or open on Google Maps for full reviews.")}
            </div>
          )}

          {/* Address + mini map */}
          {address && (
            <div className="space-y-2">
              <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                {pt ? "Endereço" : "Address"}
              </div>
              <p className="text-sm text-gray-700 leading-relaxed">{address}</p>
              {mapsEmbedUrl && (
                <div className="rounded-xl overflow-hidden border border-gray-200">
                  <iframe
                    title={`Map of ${place.name}`}
                    src={mapsEmbedUrl}
                    width="100%"
                    height="160"
                    style={{ border: 0 }}
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                    allowFullScreen
                  />
                </div>
              )}
            </div>
          )}

          {/* Hours (collapsible — 7-day list takes a lot of space) */}
          {hasHours && (
            <div>
              <button
                type="button"
                onClick={() => setHoursExpanded(!hoursExpanded)}
                className="w-full flex items-center justify-between text-left"
              >
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                  🕒 {pt ? "Horários" : "Hours"}
                </span>
                <span className={`text-gray-400 text-xs transition-transform ${hoursExpanded ? "rotate-180" : ""}`}>▾</span>
              </button>
              {hoursExpanded && (
                <ul className="mt-2 space-y-0.5 bg-gray-50 rounded-lg p-2.5">
                  {Object.entries(operatingHours).map(([day, hours]) => (
                    <li key={day} className="flex justify-between text-xs text-gray-700">
                      <span className="font-medium">{day}</span>
                      <span>{hours}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Phone + website */}
          {(place.phone || place.website) && (
            <div className="space-y-1.5">
              {place.phone && (
                <a
                  href={`tel:${place.phone}`}
                  className="flex items-center gap-2 text-sm text-coral-600 hover:underline"
                >
                  <span>📞</span>
                  <span>{place.phone}</span>
                </a>
              )}
              {place.website && (
                <a
                  href={place.website}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 text-sm text-coral-600 hover:underline"
                >
                  <span>🌐</span>
                  <span className="truncate">
                    {place.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                  </span>
                </a>
              )}
            </div>
          )}

          {/* Top reviews from Google */}
          {topReviews.length > 0 && (
            <div className="space-y-2">
              <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                {pt ? "Reviews do Google" : "Google reviews"}
              </div>
              {topReviews.map((r, i) => (
                <div
                  key={`review-${i}`}
                  className="rounded-lg bg-gray-50 border border-gray-100 p-2.5 text-xs"
                >
                  <div className="flex items-center gap-1.5 mb-1 text-[11px]">
                    {r.rating != null && (
                      <span className="text-amber-600 font-semibold">
                        ★ {Number(r.rating).toFixed(1)}
                      </span>
                    )}
                    <span className="font-medium text-gray-700 truncate">
                      {r.author || (pt ? "Anônimo" : "Anonymous")}
                    </span>
                    {r.relative_time && (
                      <span className="text-gray-400 truncate">
                        · {r.relative_time}
                      </span>
                    )}
                  </div>
                  <p className="text-gray-700 leading-snug line-clamp-3">{r.text}</p>
                </div>
              ))}
            </div>
          )}

          {/* Quick-add to a day (manual mode) */}
          {dayPlans && dayPlans.length > 0 && onAddToDay && (
            <div className="space-y-2">
              <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                {pt ? "Adicionar a um dia" : "Add to a day"}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {dayPlans.map((dp) => {
                  const isHere =
                    addedDayId === dp.id || alreadyOnDayId === dp.id;
                  return (
                    <button
                      key={dp.id}
                      type="button"
                      onClick={() => handleAddToDay(dp.id)}
                      disabled={adding || isHere}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1 ${
                        isHere
                          ? "bg-emerald-500 text-white cursor-default"
                          : "bg-coral-500 hover:bg-coral-600 text-white shadow-sm"
                      } ${adding && !isHere ? "opacity-50 cursor-wait" : ""}`}
                    >
                      {isHere && <span>✓</span>}
                      {pt ? "Dia" : "Day"} {dp.day_number}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {!hasGeo && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
              {pt
                ? "Não conseguimos localizar esse lugar no Google Maps. Você ainda pode arrastá-lo num dia, mas ele não vai aparecer no mapa."
                : "We couldn't find this place on Google Maps. You can still drag it onto a day, but it won't show on the map."}
            </p>
          )}

          {/* Footer actions */}
          <div className="flex flex-col gap-2 pt-3 border-t border-gray-100 sticky bottom-0 bg-white">
            {gmapsUrl && (
              <a
                href={gmapsUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold transition-colors shadow-sm"
              >
                <span>🗺️</span>
                {pt ? "Abrir no Google Maps" : "Open in Google Maps"}
              </a>
            )}
            {url && (
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border border-gray-200 hover:bg-gray-50 text-gray-700 text-sm font-semibold transition-colors"
              >
                <span>{sourceIconForUrl(url)}</span>
                {pt ? "Ver vídeo de origem" : "Watch source video"}
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Reusable section card with colored accent (coral/amber).
function Card({ title, accent = "gray", children }) {
  const palette = {
    coral: { bg: "bg-coral-50", border: "border-coral-100", title: "text-coral-700" },
    amber: { bg: "bg-amber-50", border: "border-amber-100", title: "text-amber-700" },
    gray: { bg: "bg-gray-50", border: "border-gray-100", title: "text-gray-700" },
  }[accent] || { bg: "bg-gray-50", border: "border-gray-100", title: "text-gray-700" };
  return (
    <div className={`rounded-xl ${palette.bg} border ${palette.border} p-3`}>
      <div className={`text-[10px] font-bold uppercase tracking-wider ${palette.title} mb-1.5`}>
        {title}
      </div>
      {children}
    </div>
  );
}

const CATEGORY_EMOJI = {
  restaurant: "🍽️",
  cafe: "☕",
  nightlife: "🍸",
  shopping: "🛍️",
  hotel: "🏨",
  attraction: "🏛️",
  place: "📍",
};

function translateCategory(cat, pt) {
  const labels = {
    restaurant: { pt: "Restaurante", en: "Restaurant" },
    cafe: { pt: "Café", en: "Café" },
    nightlife: { pt: "Vida noturna", en: "Nightlife" },
    shopping: { pt: "Compras", en: "Shopping" },
    hotel: { pt: "Hotel", en: "Hotel" },
    attraction: { pt: "Atração", en: "Attraction" },
    place: { pt: "Lugar", en: "Place" },
  };
  const entry = labels[cat] || labels.place;
  return pt ? entry.pt : entry.en;
}

function sourceIconForUrl(url) {
  if (!url) return "🔗";
  if (url.includes("tiktok")) return "🎵";
  if (url.includes("instagram")) return "📸";
  if (url.includes("youtube") || url.includes("youtu.be")) return "▶️";
  return "🔗";
}

function detectPlatform(url) {
  if (!url) return "other";
  if (url.includes("tiktok")) return "tiktok";
  if (url.includes("instagram")) return "instagram";
  if (url.includes("youtube") || url.includes("youtu.be")) return "youtube";
  return "other";
}

function shortSourceLabel(url) {
  if (!url) return "";
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host.includes("tiktok")) return "TikTok";
    if (host.includes("instagram")) return "Instagram";
    if (host.includes("youtube") || host.includes("youtu.be")) return "YouTube";
    return host;
  } catch {
    return url.length > 40 ? `${url.slice(0, 40)}…` : url;
  }
}
