import { useMemo, useState } from "react";
import { Droppable, Draggable } from "@hello-pangea/dnd";
import { useLanguage } from "../../i18n/LanguageContext";
import PlaceDetailModal from "../modals/PlaceDetailModal";

/**
 * Manual-mode-only side panel showing every place we extracted from the
 * user's links. Each card is draggable into any day_plan column on the
 * trip page (TripDetail's <DragDropContext> handles the drop). When a
 * place is dropped, TripDetail calls addItem(dayPlanId, {name, source_url})
 * and we visually mark it as "added" here so the user can see what's done.
 *
 * Places are GROUPED BY source_url so the user can see "these came from
 * this video, those from that one". This makes the pick-and-choose flow
 * intuitive for trips built from multiple videos — drag the ones you
 * actually want, skip the rest from any given source.
 *
 * Empty state messaging:
 *   - extraction still running       → "Reading your videos…"
 *   - extraction done, no places     → "Couldn't find places. Add them manually."
 *   - all places already added       → "All set — drag onto a different day if needed."
 *
 * Props:
 *   trip — the full trip object
 */

const DROPPABLE_ID = "extracted-pool";
const NO_SOURCE = "__no_source__";

function normalize(name) {
  return (name || "").trim().toLowerCase();
}

/** Best-effort short label for a source URL — domain + last path segment. */
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
    return url.length > 30 ? `${url.slice(0, 30)}…` : url;
  }
}

function sourceIcon(url) {
  if (!url) return "📝";
  if (url.includes("tiktok")) return "🎵";
  if (url.includes("instagram")) return "📸";
  if (url.includes("youtube") || url.includes("youtu.be")) return "▶️";
  return "🔗";
}

const CATEGORY_ICONS = {
  restaurant: "🍽️",
  cafe: "☕",
  nightlife: "🍸",
  shopping: "🛍️",
  hotel: "🏨",
  attraction: "🏛️",
  place: "📍",
};

export default function ExtractedPlacesPanel({ trip }) {
  const { lang } = useLanguage();
  const pt = lang === "pt-BR";
  // Click-to-open detail modal. Holds the currently expanded place
  // (or null when nothing's open). Drag still wins over click — the
  // dnd library cancels the click handler when a real drag started,
  // so the modal won't open mid-drag.
  const [detailPlace, setDetailPlace] = useState(null);

  const profile = trip?.traveler_profile || {};
  const placesMentioned = profile.places_mentioned || [];

  // Names already in the itinerary (so we can mark which extracted places
  // have been used).
  const usedNames = useMemo(() => {
    const set = new Set();
    (trip?.day_plans || []).forEach((dp) => {
      (dp.itinerary_items || []).forEach((it) => set.add(normalize(it.name)));
    });
    return set;
  }, [trip?.day_plans]);

  // Extraction state — used to show the right empty-state message.
  const links = trip?.links || [];
  const extracting = links.some((l) => l.status === "pending" || l.status === "processing");

  // Group places by source_url, preserving each place's GLOBAL index in
  // placesMentioned so the @hello-pangea/dnd Draggable index stays unique
  // and consistent across the whole droppable. The 1-based poolIndex+1
  // is also the number rendered on the card badge AND on the gray map
  // pin — that pairing is what lets the user spot "card #5 is the pin
  // in Recoleta" and decide which day it belongs on.
  const groups = useMemo(() => {
    const byUrl = new Map();
    placesMentioned.forEach((place, globalIndex) => {
      const key = place.source_url || NO_SOURCE;
      if (!byUrl.has(key)) byUrl.set(key, []);
      byUrl.get(key).push({ place, globalIndex });
    });
    // Order: groups in the order they first appear in placesMentioned, with
    // NO_SOURCE last so manually-added items don't fragment the visual flow.
    const ordered = [];
    const seen = new Set();
    placesMentioned.forEach((place) => {
      const key = place.source_url || NO_SOURCE;
      if (seen.has(key) || key === NO_SOURCE) return;
      seen.add(key);
      ordered.push({ url: key, places: byUrl.get(key) });
    });
    if (byUrl.has(NO_SOURCE)) {
      ordered.push({ url: NO_SOURCE, places: byUrl.get(NO_SOURCE) });
    }
    return ordered;
  }, [placesMentioned]);

  const totalRemaining = placesMentioned.filter(
    (p) => !usedNames.has(normalize(p.name)),
  ).length;

  return (
    <aside className="rounded-2xl bg-white border border-gray-200 overflow-hidden flex flex-col h-fit sticky top-4">
      <header className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
        <span className="text-lg">📌</span>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-gray-900">
            {pt ? "Lugares dos seus vídeos" : "Places from your videos"}
          </h3>
          <p className="text-[11px] text-gray-500">
            {pt
              ? "Arrasta pra qualquer dia"
              : "Drag onto any day"}
          </p>
        </div>
        {placesMentioned.length > 0 && (
          <span className="text-[11px] font-semibold text-coral-600 tabular-nums">
            {totalRemaining}
            <span className="text-gray-400">/{placesMentioned.length}</span>
          </span>
        )}
      </header>

      <Droppable droppableId={DROPPABLE_ID} isDropDisabled={true}>
        {(provided) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className="p-3 space-y-4 max-h-[calc(100vh-12rem)] overflow-y-auto"
          >
            {placesMentioned.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-gray-400">
                {extracting
                  ? (pt ? "Lendo seus vídeos..." : "Reading your videos...")
                  : (pt
                      ? "Nada extraído. Adiciona manualmente nos dias."
                      : "Nothing extracted. Add items manually on the days.")}
              </div>
            )}

            {groups.map(({ url, places }) => {
              const isNoSource = url === NO_SOURCE;
              const remaining = places.filter(
                ({ place }) => !usedNames.has(normalize(place.name)),
              ).length;
              return (
                <section key={url} className="space-y-1.5">
                  <header className="flex items-center gap-1.5 px-1 pb-1 border-b border-dashed border-gray-200">
                    <span className="text-sm leading-none">
                      {isNoSource ? "✏️" : sourceIcon(url)}
                    </span>
                    <div className="flex-1 min-w-0">
                      {isNoSource ? (
                        <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500">
                          {pt ? "Adicionados manualmente" : "Added manually"}
                        </span>
                      ) : (
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-[11px] font-bold uppercase tracking-wider text-gray-500 hover:text-coral-600 truncate block"
                          title={url}
                        >
                          {shortSourceLabel(url)} ↗
                        </a>
                      )}
                    </div>
                    <span className="text-[10px] font-semibold text-gray-400 tabular-nums flex-shrink-0">
                      {remaining}/{places.length}
                    </span>
                  </header>

                  {places.map(({ place, globalIndex }) => {
                    const used = usedNames.has(normalize(place.name));
                    return (
                      <Draggable
                        key={`${place.name}-${globalIndex}`}
                        draggableId={`extracted::${place.name}::${globalIndex}`}
                        index={globalIndex}
                        isDragDisabled={used}
                      >
                        {(p, snapshot) => {
                          const hasGeo = place.latitude != null && place.longitude != null;
                          const cat = place.category || "place";
                          const shortAddress = (place.address || "").split(",")[0] || "";
                          // onClick fires only when no drag happened — dnd
                          // intercepts the click during real drags.
                          const handleCardClick = (e) => {
                            if (used) return;
                            // Don't trigger when the click is on the drag
                            // handle (dnd reuses the same div for handle +
                            // body, so we filter on data-drag attribute).
                            if (snapshot.isDragging || snapshot.isDropAnimating) return;
                            e.stopPropagation();
                            setDetailPlace(place);
                          };
                          return (
                            <div
                              ref={p.innerRef}
                              {...p.draggableProps}
                              {...p.dragHandleProps}
                              onClick={handleCardClick}
                              role={used ? undefined : "button"}
                              tabIndex={used ? -1 : 0}
                              onKeyDown={(e) => {
                                if (used) return;
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  setDetailPlace(place);
                                }
                              }}
                              className={`rounded-lg border overflow-hidden text-sm transition select-none ${
                                used
                                  ? "border-gray-100 bg-gray-50 opacity-50 cursor-default"
                                  : snapshot.isDragging
                                    ? "border-coral-400 bg-coral-50 shadow-lg cursor-grabbing"
                                    : "border-gray-200 bg-white hover:border-coral-300 cursor-grab focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral-300"
                              }`}
                            >
                              <div className="flex gap-2 p-2">
                                <div className="relative flex-shrink-0">
                                  {place.photo_url ? (
                                    <img
                                      src={place.photo_url}
                                      alt=""
                                      loading="lazy"
                                      className="w-14 h-14 rounded-md object-cover bg-gray-100"
                                    />
                                  ) : (
                                    <div
                                      className={`w-14 h-14 rounded-md flex items-center justify-center text-xl ${
                                        hasGeo ? "bg-coral-50" : "bg-gray-100"
                                      }`}
                                      aria-hidden
                                    >
                                      {CATEGORY_ICONS[cat] || CATEGORY_ICONS.place}
                                    </div>
                                  )}
                                  {/* Pool number badge — matches the
                                      number on the gray map pin so the
                                      user can pair card ↔ pin visually. */}
                                  {hasGeo && !used && (
                                    <span
                                      className="absolute -top-1.5 -left-1.5 min-w-[20px] h-[20px] px-1 rounded-full bg-black text-white text-[10px] font-bold flex items-center justify-center shadow-sm border-2 border-white"
                                      title={pt ? `#${globalIndex + 1} no mapa` : `#${globalIndex + 1} on the map`}
                                    >
                                      {globalIndex + 1}
                                    </span>
                                  )}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-start justify-between gap-1">
                                    <div className="font-semibold text-gray-900 leading-snug truncate text-[13px]">
                                      {place.name}
                                    </div>
                                    {used && (
                                      <span className="text-emerald-500 text-[10px] flex-shrink-0">
                                        ✓
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-gray-500">
                                    {place.rating != null && (
                                      <span className="font-semibold text-amber-600">
                                        ★ {Number(place.rating).toFixed(1)}
                                      </span>
                                    )}
                                    {place.rating != null && shortAddress && (
                                      <span className="text-gray-300">·</span>
                                    )}
                                    {shortAddress && (
                                      <span className="truncate">{shortAddress}</span>
                                    )}
                                    {!hasGeo && place.rating == null && !shortAddress && (
                                      <span className="italic text-gray-400">
                                        {pt ? "sem dados" : "no data"}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        }}
                      </Draggable>
                    );
                  })}
                </section>
              );
            })}
            {provided.placeholder}
          </div>
        )}
      </Droppable>

      {detailPlace && (
        <PlaceDetailModal
          place={detailPlace}
          onClose={() => setDetailPlace(null)}
        />
      )}
    </aside>
  );
}

// Exported so TripDetail's handleDragEnd can detect drops from this panel.
ExtractedPlacesPanel.DROPPABLE_ID = DROPPABLE_ID;
