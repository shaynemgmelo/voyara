import { useEffect, useState } from "react";
import { useLanguage } from "../../i18n/LanguageContext";

/**
 * Detail modal for a place card in the manual-mode extracted-places
 * panel. Shows the rich Google Places data we already pre-geocoded:
 * photo, rating, review count, address, category, opening hours, link
 * to Google Maps, editorial summary, and top reviews. Click outside
 * or hit Esc to close.
 *
 * Triggered from two surfaces — both deliver the same modal:
 *   - Card click in ExtractedPlacesPanel (the panel side)
 *   - Pin click in TripMap (the map side)
 *
 * Props:
 *   place        — the places_mentioned entry (rich, post-enrichment)
 *   sourceUrl    — the video URL (override; defaults to place.source_url)
 *   onClose      — closes the modal
 *   dayPlans     — optional: passing these enables the "Add to day X"
 *                  button row at the bottom. Without this, the modal is
 *                  read-only (matches the legacy behaviour).
 *   onAddToDay   — async (dayPlanId) => void. Called when the user
 *                  picks a day to add this place to.
 *   alreadyOnDayId — optional: when the place is already in the trip,
 *                  the matching day button is highlighted "added" so the
 *                  user knows where it lives.
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
  const gmapsUrl =
    place.google_maps_url
    || (place.google_place_id
      ? `https://www.google.com/maps/place/?q=place_id:${place.google_place_id}`
      : null);

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
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Photo header — full bleed when available, gradient when not. */}
        {photo ? (
          <div className="relative h-48 w-full bg-gray-100 flex-shrink-0">
            <img
              src={photo}
              alt=""
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent pointer-events-none" />
            <button
              type="button"
              onClick={onClose}
              className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/40 hover:bg-black/60 text-white flex items-center justify-center backdrop-blur-sm"
              aria-label={pt ? "Fechar" : "Close"}
            >
              ✕
            </button>
          </div>
        ) : (
          <div className="relative h-32 w-full bg-gradient-to-br from-amber-100 to-orange-100 flex items-center justify-center text-5xl flex-shrink-0">
            <span aria-hidden>{CATEGORY_EMOJI[cat] || "📍"}</span>
            <button
              type="button"
              onClick={onClose}
              className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/80 hover:bg-white text-gray-700 flex items-center justify-center"
              aria-label={pt ? "Fechar" : "Close"}
            >
              ✕
            </button>
          </div>
        )}

        <div className="p-5 space-y-3 overflow-y-auto">
          <div>
            <h2 className="text-lg font-bold text-gray-900 leading-tight">
              {place.name}
            </h2>
            {/* Category + rating row */}
            <div className="flex items-center gap-2 mt-1.5 text-xs text-gray-500 flex-wrap">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 font-medium">
                {CATEGORY_EMOJI[cat] || "📍"} {translateCategory(cat, pt)}
              </span>
              {rating != null && (
                <span className="inline-flex items-center gap-1 text-amber-600 font-semibold">
                  ★ {Number(rating).toFixed(1)}
                  {reviewsCount > 0 && (
                    <span className="text-gray-400 font-normal">
                      ({reviewsCount.toLocaleString()})
                    </span>
                  )}
                </span>
              )}
              {pricing && (
                <span className="text-gray-600 font-semibold">{pricing}</span>
              )}
            </div>
          </div>

          {/* Creator note — what the person in the source video actually
              SAID about this place. This is the highest-signal text on
              the modal because it's the user's specific reason for being
              interested in this place (they saved THIS video). Goes
              above the editorial summary on purpose. */}
          {creatorNote && (
            <div className="rounded-lg bg-coral-50 border border-coral-100 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-coral-600 mb-1 flex items-center gap-1">
                <span>{sourceIconForUrl(url)}</span>
                {pt ? "Do criador do vídeo" : "From the video creator"}
              </div>
              <p className="text-sm text-gray-800 leading-relaxed italic">
                “{creatorNote}”
              </p>
            </div>
          )}

          {/* Editorial summary — Google's curated 1-2 sentence blurb.
              When present, this is the most useful "what is this place?"
              text. Falls back to nothing (we don't fabricate) when
              Google has no summary for this venue. */}
          {editorialSummary && (
            <div className="rounded-lg bg-amber-50 border border-amber-100 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-amber-600 mb-1">
                {pt ? "Sobre o lugar" : "About this place"}
              </div>
              <p className="text-sm text-gray-800 leading-relaxed">
                {editorialSummary}
              </p>
            </div>
          )}

          {/* Friendly fallback when we have NEITHER creator note nor
              editorial summary — beats showing a bare card with just
              address + phone. Tells the user where to look for more. */}
          {!creatorNote && !editorialSummary && (
            <div className="rounded-lg bg-gray-50 border border-gray-100 p-3 text-xs text-gray-600 leading-relaxed">
              {isExperience
                ? (pt
                    ? "Essa experiência foi citada no vídeo do criador. Veja o vídeo de origem para o contexto exato — o que recomendou, melhor horário, dicas práticas."
                    : "This experience was mentioned in the source video. Check the original video for context — recommendations, best time, practical tips.")
                : (pt
                    ? "Sem descrição editorial pra esse lugar. Veja o vídeo de origem — o criador certamente comentou algo específico — ou abra no Google Maps pra reviews completos e fotos."
                    : "No editorial description for this place. Watch the source video for the creator's take, or open it on Google Maps for full reviews and photos.")}
            </div>
          )}

          {address && (
            <Section icon="📍" label={pt ? "Endereço" : "Address"}>
              {address}
            </Section>
          )}

          {place.operating_hours && Object.keys(place.operating_hours).length > 0 && (
            <Section icon="🕒" label={pt ? "Horários" : "Hours"}>
              <ul className="space-y-0.5">
                {Object.entries(place.operating_hours).map(([day, hours]) => (
                  <li key={day} className="text-xs text-gray-600">
                    <span className="font-medium text-gray-700">{day}:</span>{" "}
                    {hours}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {place.phone && (
            <Section icon="📞" label={pt ? "Telefone" : "Phone"}>
              {place.phone}
            </Section>
          )}

          {place.website && (
            <Section icon="🌐" label={pt ? "Site" : "Website"}>
              <a
                href={place.website}
                target="_blank"
                rel="noreferrer"
                className="text-coral-600 hover:underline truncate block"
              >
                {place.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
              </a>
            </Section>
          )}

          {/* Top reviews — what real visitors said, capped at 3 by the
              backend so we don't drown the modal in opinions. Each review
              is a quote-card with author + rating + relative time. */}
          {topReviews.length > 0 && (
            <div className="space-y-2">
              <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                {pt ? "O que dizem" : "What people say"}
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
                  <p className="text-gray-700 leading-snug line-clamp-3">
                    {r.text}
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Quick-add buttons — when the parent passes dayPlans + onAddToDay,
              the user can drop this place onto any day with a single click,
              right from the modal. Replaces the "drag from map" gesture
              that's awkward when the pin is far from the day list.
              The day this place already belongs to (if any) shows as added,
              so the user gets immediate feedback the click landed. */}
          {dayPlans && dayPlans.length > 0 && onAddToDay && (
            <div className="space-y-1.5">
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
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-1 ${
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
          <div className="flex flex-col gap-2 pt-2 border-t border-gray-100">
            {gmapsUrl && (
              <a
                href={gmapsUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors"
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
                className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-700 text-sm font-medium transition-colors"
              >
                <span>{sourceIconForUrl(url)}</span>
                {pt ? "Ver vídeo de origem" : "Watch source video"}
              </a>
            )}
          </div>

          <p className="text-[10px] text-gray-400 text-center pt-1">
            {pt
              ? "Arraste o card pra um dia pra adicionar ao roteiro."
              : "Drag the card onto a day to add it to the itinerary."}
          </p>
        </div>
      </div>
    </div>
  );
}

function Section({ icon, label, children }) {
  return (
    <div className="flex gap-2 text-sm">
      <span className="text-base leading-none flex-shrink-0 mt-0.5">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-0.5">
          {label}
        </div>
        <div className="text-gray-700 text-xs leading-relaxed">{children}</div>
      </div>
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
