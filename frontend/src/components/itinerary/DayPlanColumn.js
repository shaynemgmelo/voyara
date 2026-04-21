import { useState } from "react";
import { Droppable, Draggable } from "@hello-pangea/dnd";
import ItineraryItem from "./ItineraryItem";
import AlternativeGroup from "./AlternativeGroup";
import TravelSegment from "./TravelSegment";
import FeedbackBox from "./FeedbackBox";
import { getDayColor } from "../../utils/colors";
import { useLanguage } from "../../i18n/LanguageContext";

export default function DayPlanColumn({
  dayPlan,
  tripId,
  selectedItemId,
  hoveredItemId,
  vibeFilters = [],
  travelSegments = [],
  hotelLodging = null,
  onItemClick,
  onItemHover,
  onAddClick,
  onDeleteItem,
  onSwapItem,
  onSelectDay,
  isSelectedDay,
  onRecalculate,
  onRefine,
  refineLoading,
}) {
  const { t, lang } = useLanguage();
  const pt = lang === "pt-BR";
  const color = getDayColor(dayPlan.day_number);
  const [collapsed, setCollapsed] = useState(false);
  const [selectedAlts, setSelectedAlts] = useState({});

  const items = dayPlan.itinerary_items || [];
  const filteredItems = vibeFilters.length > 0
    ? items.filter((item) =>
        vibeFilters.some((f) => item.vibe_tags?.includes(f))
      )
    : items;

  // Calculate travel stats from segments
  const travelStats = (() => {
    let walkKm = 0, walkMin = 0, driveKm = 0, driveMin = 0;
    let hasWalking = false, hasDriving = false;

    travelSegments.forEach((seg) => {
      if (seg.walking) {
        const km = parseFloat((seg.walking.distance_text || "").replace(",", "."));
        const min = seg.walking.duration_value ? Math.round(seg.walking.duration_value / 60) : 0;
        if (!isNaN(km)) walkKm += km;
        if (min > 0) walkMin += min;
        hasWalking = true;
      }
      if (seg.driving) {
        const km = parseFloat((seg.driving.distance_text || "").replace(",", "."));
        const min = seg.driving.duration_value ? Math.round(seg.driving.duration_value / 60) : 0;
        if (!isNaN(km)) driveKm += km;
        if (min > 0) driveMin += min;
        hasDriving = true;
      }
    });

    // Walkability assessment
    // ≤ 8km total and no single leg > 2km → fully walkable
    // ≤ 15km → mostly walkable but tiring
    // > 15km → needs transport
    const maxSingleLeg = travelSegments.reduce((max, seg) => {
      const km = parseFloat((seg.walking?.distance_text || "").replace(",", "."));
      return isNaN(km) ? max : Math.max(max, km);
    }, 0);

    let walkability = "easy"; // default
    if (walkKm > 15 || maxSingleLeg > 3) walkability = "transport";
    else if (walkKm > 8 || maxSingleLeg > 2) walkability = "moderate";

    return { walkKm, walkMin, driveKm, driveMin, hasWalking, hasDriving, walkability, maxSingleLeg };
  })();

  const totalDistance = travelStats.walkKm;

  // Calculate hotel distance (straight-line Haversine) to first & last items
  const hotelDistances = (() => {
    if (!hotelLodging?.latitude || !hotelLodging?.longitude || filteredItems.length === 0) return null;
    const hLat = parseFloat(hotelLodging.latitude);
    const hLng = parseFloat(hotelLodging.longitude);
    if (isNaN(hLat) || isNaN(hLng)) return null;

    const haversine = (lat1, lon1, lat2, lon2) => {
      const R = 6371;
      const dLat = ((lat2 - lat1) * Math.PI) / 180;
      const dLon = ((lon2 - lon1) * Math.PI) / 180;
      const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    const withCoords = filteredItems.filter(i => i.latitude && i.longitude);
    if (withCoords.length === 0) return null;

    const first = withCoords[0];
    const last = withCoords[withCoords.length - 1];
    const toFirst = haversine(hLat, hLng, parseFloat(first.latitude), parseFloat(first.longitude));
    const toLast = haversine(hLat, hLng, parseFloat(last.latitude), parseFloat(last.longitude));

    // Farthest point from hotel
    let maxDist = 0;
    let farthestName = "";
    withCoords.forEach(i => {
      const d = haversine(hLat, hLng, parseFloat(i.latitude), parseFloat(i.longitude));
      if (d > maxDist) { maxDist = d; farthestName = i.name; }
    });

    return { toFirst, toLast, maxDist, farthestName, hotelName: hotelLodging.name };
  })();

  // Group items by alternative_group
  const groupedItems = [];
  const seenGroups = new Set();
  filteredItems?.forEach((item) => {
    if (item.alternative_group && !seenGroups.has(item.alternative_group)) {
      seenGroups.add(item.alternative_group);
      const groupItems = filteredItems.filter((i) => i.alternative_group === item.alternative_group);
      groupedItems.push({ type: "group", group: item.alternative_group, items: groupItems });
    } else if (!item.alternative_group) {
      groupedItems.push({ type: "single", item });
    }
  });

  // Build a position lookup: item.id → 1-based index within the day
  const itemPositions = {};
  (filteredItems || []).forEach((item, idx) => {
    itemPositions[item.id] = idx + 1;
  });

  return (
    <div className="mb-5">
      {/* Day Header — Roamy-inspired with stats */}
      <div
        className={`rounded-xl border transition-all duration-200 ${
          isSelectedDay
            ? "border-gray-200 bg-white shadow-sm"
            : "border-gray-100 bg-gray-50/50 hover:bg-white hover:border-gray-200 hover:shadow-sm"
        }`}
      >
        <button
          onClick={() => { onSelectDay(); }}
          className="w-full flex items-center gap-3 px-4 py-3 text-left"
        >
          {/* Day badge */}
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-white text-xs font-bold flex-shrink-0"
            style={{ backgroundColor: color }}
          >
            {t("dayPlan.day")} {dayPlan.day_number}
          </div>

          {/* City name */}
          {dayPlan.city && (
            <span className="font-semibold text-sm text-gray-900">
              {dayPlan.city}
            </span>
          )}

          {/* Phase 5.1 — origin + rigidity chip. Locked days carry the video
              creator handle; day-trip days get a distinct car emoji chip. */}
          {dayPlan.rigidity === "locked" && (
            <span
              className="flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 flex-shrink-0"
              title={pt
                ? "Dia travado pela estrutura do vídeo. Itens protegidos contra edição automática."
                : "Day locked by video structure. Items protected from auto-edits."}
            >
              <span>🔒</span>
              {pt ? "Do vídeo" : "From video"}
              {dayPlan.source_creator_handle && (
                <span className="opacity-70">• {dayPlan.source_creator_handle}</span>
              )}
            </span>
          )}
          {dayPlan.rigidity === "partially_flexible" && (
            <span
              className="flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-600 flex-shrink-0"
              title={pt
                ? "Dia parcialmente baseado no vídeo — alguns itens fixos."
                : "Day partially from video — some fixed items."}
            >
              <span>📎</span>
              {pt ? "Parcial do vídeo" : "Partly from video"}
            </span>
          )}
          {dayPlan.day_type === "day_trip" && (
            <span
              className="flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 flex-shrink-0"
              title={pt ? "Bate-volta para outra cidade." : "Day trip out of town."}
            >
              <span>🚗</span>
              {pt ? "Bate-volta" : "Day trip"}
            </span>
          )}

          {/* Compact stats — always visible */}
          <div className="flex items-center gap-2 ml-auto text-[11px] text-gray-400 flex-shrink-0">
            {items.length > 0 && (
              <span className="flex items-center gap-1">
                <span className="text-[10px]">📍</span>
                <span className="font-medium">{items.length}</span>
              </span>
            )}
            {totalDistance > 0 && (
              <span className="flex items-center gap-1 font-medium">
                <span className="text-[10px]">🚶</span>
                {totalDistance.toFixed(1)} km
              </span>
            )}
            {totalDistance > 0 && travelStats.walkMin > 0 && (
              <span className="flex items-center gap-1 font-medium">
                <span className="text-[10px]">⏱</span>
                {travelStats.walkMin < 60
                  ? `${travelStats.walkMin}min`
                  : `${Math.floor(travelStats.walkMin / 60)}h${travelStats.walkMin % 60 > 0 ? (travelStats.walkMin % 60) : ""}`
                }
              </span>
            )}

            {/* Collapse toggle */}
            <svg
              className={`w-4 h-4 text-gray-300 transition-transform duration-200 ${collapsed ? "" : "rotate-180"}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              onClick={(e) => { e.stopPropagation(); setCollapsed(!collapsed); }}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </button>

        {/* Distance stats panel — always visible when there's data */}
        {(travelSegments.length > 0 || hotelDistances) && (
          <div className="px-4 pb-2.5 border-t border-gray-100/60">
            {/* Stats row */}
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              {/* Total route distance */}
              {travelStats.walkKm > 0 && (
                <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-blue-50 text-[10px]">
                  <span>🚶</span>
                  <span className="font-bold text-blue-700">{travelStats.walkKm.toFixed(1)} km</span>
                  {travelStats.walkMin > 0 && (
                    <span className="text-blue-500">
                      {travelStats.walkMin < 60
                        ? `${travelStats.walkMin} min`
                        : `${Math.floor(travelStats.walkMin / 60)}h${travelStats.walkMin % 60 > 0 ? (travelStats.walkMin % 60 + "min") : ""}`
                      } {pt ? "andando" : "walking"}
                    </span>
                  )}
                </div>
              )}

              {/* Driving distance — when day is spread out */}
              {travelStats.driveKm > 0 && travelStats.walkability !== "easy" && (
                <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-gray-50 text-[10px]">
                  <span>🚗</span>
                  <span className="font-bold text-gray-700">{travelStats.driveKm.toFixed(1)} km</span>
                  {travelStats.driveMin > 0 && (
                    <span className="text-gray-400">{travelStats.driveMin} min</span>
                  )}
                </div>
              )}

              {/* Hotel → first spot */}
              {hotelDistances && (
                <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-violet-50 text-[10px]">
                  <span>🏨→📍</span>
                  <span className="font-bold text-violet-700">{hotelDistances.toFirst.toFixed(1)} km</span>
                  <span className="text-violet-500">{pt ? "do hotel" : "from hotel"}</span>
                </div>
              )}

              {/* Farthest point from hotel */}
              {hotelDistances && hotelDistances.maxDist > 2 && (
                <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-50 text-[10px]">
                  <span>📏</span>
                  <span className="font-bold text-amber-700">{hotelDistances.maxDist.toFixed(1)} km</span>
                  <span className="text-amber-600 truncate max-w-[120px]">{pt ? "mais longe" : "farthest"}</span>
                </div>
              )}
            </div>

            {/* Walkability tip */}
            {travelStats.walkKm > 0 && (
              <div className={`mt-1.5 flex items-start gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-medium leading-snug ${
                travelStats.walkability === "easy"
                  ? "bg-emerald-50 text-emerald-700"
                  : travelStats.walkability === "moderate"
                  ? "bg-amber-50 text-amber-700"
                  : "bg-red-50 text-red-700"
              }`}>
                <span className="flex-shrink-0">{travelStats.walkability === "easy" ? "✅" : travelStats.walkability === "moderate" ? "⚠️" : "🚌"}</span>
                <span>
                  {travelStats.walkability === "easy"
                    ? (pt ? "Dia tranquilo! Tudo pertinho, dá pra fazer a pé" : "Easy day! Everything close, fully walkable")
                    : travelStats.walkability === "moderate"
                    ? (pt
                        ? `Dia caminhável mas cansativo. Considere transporte em trechos longos`
                        : `Walkable but tiring day. Consider transport for longer stretches`)
                    : (pt
                        ? `Dia espalhado — recomendamos metrô ou táxi entre alguns pontos`
                        : `Spread out day — we recommend metro or taxi between some points`)
                  }
                </span>
              </div>
            )}

            {/* Hotel return tip */}
            {hotelDistances && hotelDistances.toLast > 3 && (
              <div className="mt-1 flex items-start gap-1.5 px-2.5 py-1.5 rounded-lg bg-violet-50/70 text-[10px] font-medium text-violet-700 leading-snug">
                <span className="flex-shrink-0">🏨</span>
                <span>
                  {pt
                    ? `Volta pro hotel: ~${hotelDistances.toLast.toFixed(1)} km do último ponto`
                    : `Return to hotel: ~${hotelDistances.toLast.toFixed(1)} km from last stop`}
                </span>
              </div>
            )}

            {/* Optimize route button */}
            {isSelectedDay && onRecalculate && items.length >= 2 && (
              <button
                onClick={onRecalculate}
                className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 text-blue-600 text-[10px] font-bold hover:bg-blue-100 transition-colors"
              >
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                </svg>
                {pt ? "Otimizar rota" : "Optimize route"}
              </button>
            )}
          </div>
        )}

        {/* Optimize button when no travel data yet */}
        {isSelectedDay && travelSegments.length === 0 && !hotelDistances && items.length >= 2 && onRecalculate && (
          <div className="px-4 pb-2">
            <button
              onClick={onRecalculate}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 text-blue-600 text-[10px] font-bold hover:bg-blue-100 transition-colors"
            >
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
              </svg>
              {pt ? "Otimizar rota" : "Optimize route"}
            </button>
          </div>
        )}
      </div>

      {/* Items list — collapsible */}
      {!collapsed && (
        <Droppable droppableId={String(dayPlan.id)}>
          {(provided, snapshot) => (
            <div
              ref={provided.innerRef}
              {...provided.droppableProps}
              className={`mt-2 ml-2 space-y-1 min-h-[32px] rounded-xl transition-colors ${
                snapshot.isDraggingOver ? "bg-coral-50/50 ring-1 ring-coral-200" : ""
              }`}
            >
              {groupedItems.map((entry, index) => {
                if (entry.type === "group") {
                  return (
                    <div key={entry.group} className="mb-1">
                      <AlternativeGroup
                        items={entry.items}
                        dayColor={color}
                        selectedItemId={selectedItemId}
                        selectedAlt={selectedAlts[entry.group]}
                        onSelect={(id) => setSelectedAlts((prev) => ({ ...prev, [entry.group]: id }))}
                        onItemClick={onItemClick}
                      />
                    </div>
                  );
                }
                const item = entry.item;
                const currentPos = itemPositions[item.id] || (index + 1);
                const prevEntry = index > 0 ? groupedItems[index - 1] : null;
                const prevItemId = prevEntry?.type === "single" ? prevEntry.item.id : null;
                const segment = prevItemId
                  ? travelSegments.find((s) => s.from_id === prevItemId && s.to_id === item.id)
                  : null;

                return (
                  <div key={item.id}>
                    {segment && <TravelSegment segment={segment} />}
                    <Draggable draggableId={String(item.id)} index={index}>
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                          {...provided.dragHandleProps}
                        >
                          <ItineraryItem
                            item={item}
                            tripId={tripId}
                            dayPlanId={dayPlan.id}
                            dayColor={color}
                            dayIndex={currentPos}
                            isSelected={selectedItemId === item.id}
                            isHovered={hoveredItemId === item.id}
                            isDragging={snapshot.isDragging}
                            onClick={() => onItemClick(item)}
                            onHover={(hovered) => onItemHover(hovered ? item.id : null)}
                            onDelete={() => onDeleteItem(item.id)}
                            onSwap={onSwapItem}
                          />
                        </div>
                      )}
                    </Draggable>
                  </div>
                );
              })}
              {provided.placeholder}

              {/* Add place + AI feedback */}
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={onAddClick}
                  className="flex-1 py-2 text-xs text-gray-400 hover:text-coral-500 hover:bg-coral-50/50 rounded-lg transition-all border border-dashed border-gray-200 hover:border-coral-300 font-medium"
                >
                  + {t("dayPlan.addPlace")}
                </button>
              </div>

              {onRefine && items.length > 0 && (
                <div className="mt-1">
                  <FeedbackBox
                    alwaysOpen
                    loading={refineLoading}
                    placeholder={t("feedback.placeholderDay")}
                    onSubmit={(feedback) => onRefine(dayPlan.id, feedback)}
                  />
                </div>
              )}
            </div>
          )}
        </Droppable>
      )}

      {/* Collapsed preview — show item thumbnails like Roamy */}
      {collapsed && items.length > 0 && (
        <div className="mt-2 ml-4 flex items-center gap-1.5 overflow-x-auto pb-1">
          {items.slice(0, 6).map((item, i) => (
            <div
              key={item.id}
              className="w-10 h-10 rounded-lg bg-gray-200 flex-shrink-0 overflow-hidden flex items-center justify-center text-[10px] text-gray-500"
              title={item.name}
            >
              {(item.photos && item.photos[0]) || item.photo_url ? (
                <img
                  src={item.photos?.[0] || item.photo_url}
                  alt=""
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              ) : (
                <span className="text-base">{["🏛️", "🍽️", "🎯", "🛍️", "📍", "🏨"][i % 6]}</span>
              )}
            </div>
          ))}
          {items.length > 6 && (
            <div className="w-10 h-10 rounded-lg bg-gray-100 flex-shrink-0 flex items-center justify-center text-[10px] text-gray-400 font-bold">
              +{items.length - 6}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
