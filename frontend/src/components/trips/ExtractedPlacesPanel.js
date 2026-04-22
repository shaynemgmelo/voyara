import { useMemo } from "react";
import { Droppable, Draggable } from "@hello-pangea/dnd";
import { useLanguage } from "../../i18n/LanguageContext";

/**
 * Manual-mode-only side panel showing every place we extracted from the
 * user's links. Each card is draggable into any day_plan column on the
 * trip page (TripDetail's <DragDropContext> handles the drop). When a
 * place is dropped, TripDetail calls addItem(dayPlanId, {name, source_url})
 * and we visually mark it as "added" here so the user can see what's done.
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

function normalize(name) {
  return (name || "").trim().toLowerCase();
}

export default function ExtractedPlacesPanel({ trip }) {
  const { lang } = useLanguage();
  const pt = lang === "pt-BR";

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
            {placesMentioned.filter((p) => !usedNames.has(normalize(p.name))).length}
            <span className="text-gray-400">/{placesMentioned.length}</span>
          </span>
        )}
      </header>

      <Droppable droppableId={DROPPABLE_ID} isDropDisabled={true}>
        {(provided) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className="p-3 space-y-2 max-h-[calc(100vh-12rem)] overflow-y-auto"
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

            {placesMentioned.map((place, index) => {
              const used = usedNames.has(normalize(place.name));
              return (
                <Draggable
                  key={`${place.name}-${index}`}
                  draggableId={`extracted::${place.name}::${index}`}
                  index={index}
                  isDragDisabled={used}
                >
                  {(p, snapshot) => (
                    <div
                      ref={p.innerRef}
                      {...p.draggableProps}
                      {...p.dragHandleProps}
                      className={`rounded-lg border p-3 text-sm transition select-none ${
                        used
                          ? "border-gray-100 bg-gray-50 opacity-50 cursor-default"
                          : snapshot.isDragging
                            ? "border-coral-400 bg-coral-50 shadow-lg cursor-grabbing"
                            : "border-gray-200 bg-white hover:border-coral-300 cursor-grab"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-medium text-gray-900 leading-snug min-w-0">
                          {place.name}
                        </div>
                        {used && (
                          <span className="text-emerald-500 text-xs flex-shrink-0">
                            ✓ {pt ? "no roteiro" : "added"}
                          </span>
                        )}
                      </div>
                      {place.source_url && !used && (
                        <a
                          href={place.source_url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="block mt-1 text-[10px] text-gray-400 hover:text-coral-600 truncate"
                        >
                          {pt ? "do vídeo" : "from video"} ↗
                        </a>
                      )}
                    </div>
                  )}
                </Draggable>
              );
            })}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </aside>
  );
}

// Exported so TripDetail's handleDragEnd can detect drops from this panel.
ExtractedPlacesPanel.DROPPABLE_ID = DROPPABLE_ID;
