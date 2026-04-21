import React, { useMemo, useState } from "react";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
// Shared with TripMap so the pill color == pin color on the map.
import { getDayColor } from "../../utils/colors";

// Elfsight-inspired palette: sage / mint greens with warm accents
const BRAND = {
  primary: "#10B981", // emerald
  primaryDark: "#059669",
  primaryMuted: "#D1FAE5", // pale mint
  cardBg: "#F0FDF4", // almost-white mint
  ink: "#0F172A",
  textMuted: "#64748B",
};

const CATEGORY_COLORS = {
  restaurant: "#D97706", // amber
  restaurante: "#D97706",
  food: "#D97706",
  attraction: "#059669", // emerald
  atracao: "#059669",
  atração: "#059669",
  museum: "#7C3AED", // violet
  bar: "#DC2626", // red
  beach: "#0891B2", // cyan
  praia: "#0891B2",
  shopping: "#DB2777", // pink
  nature: "#059669",
  default: BRAND.primary,
};

const CATEGORY_ICONS = {
  restaurant: "🍽️",
  restaurante: "🍽️",
  food: "🍽️",
  attraction: "🏛️",
  atracao: "🏛️",
  atração: "🏛️",
  museum: "🖼️",
  bar: "🍸",
  beach: "🏖️",
  praia: "🏖️",
  shopping: "🛍️",
  nature: "🌿",
  default: "📍",
};

function categoryColor(cat) {
  if (!cat) return CATEGORY_COLORS.default;
  const key = cat.toString().toLowerCase();
  return CATEGORY_COLORS[key] || CATEGORY_COLORS.default;
}

function categoryIcon(cat) {
  if (!cat) return CATEGORY_ICONS.default;
  const key = cat.toString().toLowerCase();
  return CATEGORY_ICONS[key] || CATEGORY_ICONS.default;
}

function placeholderImage(name, color) {
  const initial = (name?.charAt(0) || "?").toUpperCase();
  const bg = encodeURIComponent(color.replace("#", ""));
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='600' height='400' viewBox='0 0 600 400'><rect width='600' height='400' fill='%23${bg}'/><text x='50%' y='50%' font-family='system-ui,Arial' font-size='140' font-weight='700' fill='white' text-anchor='middle' dominant-baseline='central'>${initial}</text></svg>`;
  return `data:image/svg+xml;utf8,${svg}`;
}

function sourceBadge(source, sourceUrl) {
  // Only show badge for places that came FROM the user's link.
  // AI-suggested and manually-added places get NO badge (default state).
  if (source !== "link") return null;

  const platform = (sourceUrl || "").toLowerCase();
  let label = "Do seu link";
  let emoji = "📎";
  if (platform.includes("tiktok")) {
    emoji = "🎵";
    label = "Do TikTok";
  } else if (platform.includes("instagram")) {
    emoji = "📸";
    label = "Do Instagram";
  } else if (platform.includes("youtube") || platform.includes("youtu.be")) {
    emoji = "▶️";
    label = "Do YouTube";
  }
  return {
    emoji,
    label,
    style: "bg-white/95 text-slate-900 ring-1 ring-slate-900/10",
  };
}

function ItemCard({
  item,
  dragHandleProps,
  isDragging,
  onClick,
  onDelete,
  onSwap,
}) {
  const color = categoryColor(item.category);
  const icon = categoryIcon(item.category);
  const image =
    item.photo_url ||
    (item.photos && item.photos[0]) ||
    placeholderImage(item.name, color);
  const badge = sourceBadge(item.source, item.source_url);

  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={`flex flex-col rounded-2xl overflow-hidden shadow-sm border transition cursor-pointer ${
        isDragging
          ? "shadow-2xl scale-[1.02] border-emerald-400"
          : "border-emerald-100 hover:border-emerald-300 hover:shadow-md"
      }`}
      style={{ backgroundColor: BRAND.cardBg }}
    >
      <div className="relative h-44 w-full overflow-hidden bg-gray-100">
        <img
          src={image}
          alt={item.name}
          className="w-full h-full object-cover"
          onError={(e) => {
            e.target.src = placeholderImage(item.name, color);
          }}
        />
        {badge && (
          <div
            className={`absolute top-2 left-2 inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide shadow-md backdrop-blur-sm ${badge.style}`}
            title={item.source_url || ""}
          >
            <span>{badge.emoji}</span>
            <span>{badge.label}</span>
          </div>
        )}
        {/* Action buttons overlay (top-right) */}
        <div className="absolute top-2 right-2 flex gap-1.5">
          {onSwap && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSwap();
              }}
              className="w-8 h-8 rounded-lg bg-black/60 hover:bg-emerald-600 backdrop-blur-sm flex items-center justify-center transition-colors"
              title="Substituir por outra sugestão"
              aria-label="Substituir"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="17 1 21 5 17 9" />
                <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                <polyline points="7 23 3 19 7 15" />
                <path d="M21 13v2a4 4 0 0 1-4 4H3" />
              </svg>
            </button>
          )}
          {onDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="w-8 h-8 rounded-lg bg-black/60 hover:bg-red-600 backdrop-blur-sm flex items-center justify-center transition-colors"
              title="Remover"
              aria-label="Remover"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
              </svg>
            </button>
          )}
          {dragHandleProps && (
            // Drag handle — emerald so it stands out from swap/delete, with
            // a text label that slides out on hover so first-time users
            // instantly see what it does.
            <div
              {...dragHandleProps}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              className="group/drag h-8 px-2 rounded-lg bg-emerald-600/90 hover:bg-emerald-500 backdrop-blur-sm flex items-center gap-1.5 cursor-grab active:cursor-grabbing transition-all"
              title="Arraste para reordenar — os horários se ajustam sozinhos"
              aria-label="Arrastar para reordenar"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="9" cy="5" r="1" />
                <circle cx="9" cy="12" r="1" />
                <circle cx="9" cy="19" r="1" />
                <circle cx="15" cy="5" r="1" />
                <circle cx="15" cy="12" r="1" />
                <circle cx="15" cy="19" r="1" />
              </svg>
              <span className="text-white text-[10px] font-semibold max-w-0 overflow-hidden group-hover/drag:max-w-[80px] transition-all duration-200 whitespace-nowrap">
                Arraste
              </span>
            </div>
          )}
        </div>
      </div>
      <div className="p-5 flex-1 flex flex-col">
        <div
          className="text-xs font-bold uppercase tracking-wider mb-2"
          style={{ color }}
        >
          <span className="mr-1">{icon}</span>
          {item.category || "Lugar"}
        </div>
        <h3 className="text-lg font-bold text-gray-900 mb-2 leading-tight">
          {item.name}
        </h3>
        {item.start_time && (
          <div className="text-sm text-gray-500 mb-2">
            ⏰ {item.start_time.slice(0, 5)}
            {item.end_time ? ` – ${item.end_time.slice(0, 5)}` : ""}
          </div>
        )}
        {item.address && (
          <div className="text-sm text-gray-600 mb-2 line-clamp-1">
            📍 {item.address}
          </div>
        )}
        {item.rating ? (
          <div className="text-sm text-amber-600 font-semibold">
            ★ {Number(item.rating).toFixed(1)}
          </div>
        ) : null}
        {item.notes && (
          <p className="text-sm text-gray-600 mt-3 line-clamp-3">{item.notes}</p>
        )}
      </div>
    </div>
  );
}

export default function TripTimeline({
  dayPlans,
  onReorder,
  onMoveBetweenDays,
  onItemClick,
  onDeleteItem,
  onSwapItem,
}) {
  const [activeDayIdx, setActiveDayIdx] = useState(0);
  const [, setIsDraggingCard] = useState(false);

  // Show ALL days (including empty ones). User asked for N days — show N.
  const allDays = useMemo(() => dayPlans || [], [dayPlans]);

  if (!allDays.length) {
    return (
      <div className="text-center py-16 text-gray-500">
        <div className="text-5xl mb-3">📍</div>
        <p>Nenhum dia ainda.</p>
      </div>
    );
  }

  const handleDragStart = () => setIsDraggingCard(true);

  const handleDragEnd = (result) => {
    setIsDraggingCard(false);
    if (!result.destination) return;

    const sourceDayId = parseInt(result.source.droppableId, 10);
    // Destination droppableId can be either "day-<id>" (a day pill) or a
    // plain day_id (the active day's swiper). When it's the pill, we're
    // doing a cross-day move.
    const rawDest = String(result.destination.droppableId);
    const isPillDrop = rawDest.startsWith("day-");
    const destDayId = isPillDrop
      ? parseInt(rawDest.replace("day-", ""), 10)
      : parseInt(rawDest, 10);

    // Cross-day drag (drop on a pill of a different day).
    if (destDayId !== sourceDayId) {
      if (!onMoveBetweenDays) return;
      const itemId = parseInt(result.draggableId, 10);
      const destDay = allDays.find((d) => d.id === destDayId);
      const destIndex = destDay ? (destDay.itinerary_items || []).length : 0;
      onMoveBetweenDays({ sourceDayId, destDayId, itemId, destIndex });
      // Switch focus to destination day so the user sees the item land.
      const newIdx = allDays.findIndex((d) => d.id === destDayId);
      if (newIdx >= 0) setActiveDayIdx(newIdx);
      return;
    }

    // Same day: reorder.
    if (result.source.index === result.destination.index) return;
    if (!onReorder) return;
    const day = allDays.find((d) => d.id === sourceDayId);
    if (!day) return;
    const originalItems = day.itinerary_items || [];
    const reordered = Array.from(originalItems);
    const [moved] = reordered.splice(result.source.index, 1);
    reordered.splice(result.destination.index, 0, moved);
    const itemIds = reordered.map((i) => i.id);
    onReorder({ dayPlanId: sourceDayId, itemIds });
  };

  const day = allDays[activeDayIdx];
  const items = day.itinerary_items || [];

  return (
    <DragDropContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
    <div className="w-full">
      {/* Day tabs — each one is also a drop target, so dragging a card
          over "DIA 3" moves the card to Day 3 with visual feedback
          (the pill pulses + glows in the day's color). */}
      <div className="mb-4 -mx-2 overflow-x-auto scrollbar-thin">
        <div className="flex items-center gap-2 px-2 pb-2 min-w-max">
          {allDays.map((d, idx) => {
            const isActive = idx === activeDayIdx;
            const count = (d.itinerary_items || []).length;
            // Same color the map paints the pins with — so the pill is an
            // instant key for "which pins on the map are mine".
            const dayColor = getDayColor(d.day_number);
            return (
              <Droppable key={d.id} droppableId={`day-${d.id}`} type="ITEM">
                {(dropProv, dropSnap) => (
                  <button
                    ref={dropProv.innerRef}
                    {...dropProv.droppableProps}
                    onClick={() => setActiveDayIdx(idx)}
                    className={`group flex-shrink-0 flex items-center gap-2 px-4 py-2 rounded-full font-semibold text-sm transition-all ${
                      isActive
                        ? "text-white shadow-lg"
                        : "bg-white border text-slate-700 hover:shadow-sm"
                    } ${
                      dropSnap.isDraggingOver && !isActive
                        ? "ring-4 ring-offset-1 scale-110"
                        : ""
                    }`}
                    style={
                      isActive
                        ? {
                            backgroundColor: dayColor,
                            boxShadow: `0 10px 24px -8px ${dayColor}88`,
                          }
                        : {
                            borderColor: dropSnap.isDraggingOver
                              ? dayColor
                              : `${dayColor}55`,
                            backgroundColor: dropSnap.isDraggingOver
                              ? `${dayColor}1a`
                              : undefined,
                            borderWidth: dropSnap.isDraggingOver ? "2px" : undefined,
                          }
                    }
                  >
                    {/* Color dot — matches the pin on the map for this day. */}
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{
                        backgroundColor: isActive ? "#ffffff" : dayColor,
                        boxShadow: isActive ? "0 0 0 2px rgba(255,255,255,0.35)" : "none",
                      }}
                      aria-hidden="true"
                    />
                    <span className="text-xs font-bold tracking-wide">
                      DIA {d.day_number}
                      {dropSnap.isDraggingOver && !isActive && " ←"}
                    </span>
                    {d.city ? (
                      <span className="opacity-80 font-normal">• {d.city}</span>
                    ) : null}
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                        isActive ? "bg-white/25 text-white" : "text-white"
                      }`}
                      style={isActive ? {} : { backgroundColor: dayColor }}
                    >
                      {count}
                    </span>
                    {/* Hidden — Droppable needs this but pills are not a
                        real list of Draggables, they only accept drops. */}
                    <span style={{ display: "none" }}>{dropProv.placeholder}</span>
                  </button>
                )}
              </Droppable>
            );
          })}
        </div>
      </div>

      {/* Active day header (contextual) */}
      <div className="flex items-baseline justify-between mb-4 px-2">
        <div className="text-sm" style={{ color: BRAND.textMuted }}>
          {items.length === 0
            ? "Nenhum lugar ainda neste dia"
            : `${items.length} ${items.length === 1 ? "lugar" : "lugares"}${
                day.city ? ` em ${day.city}` : ""
              }`}
        </div>
        {items.length > 1 && (
          <div className="text-xs" style={{ color: BRAND.textMuted }}>
            Arraste para navegar →
          </div>
        )}
      </div>

      {/* Empty state for day with no places */}
      {items.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white/50 py-14 px-6 text-center">
          <div className="text-4xl mb-3">🗺️</div>
          <h3 className="text-lg font-semibold text-slate-900 mb-1">
            Dia {day.day_number} ainda vazio
          </h3>
          <p className="text-sm text-slate-500 max-w-md mx-auto mb-5">
            A IA ainda não preencheu este dia. Você pode colar um link de
            viagem ou pedir pra IA sugerir lugares no chat do roteiro.
          </p>
          <div className="text-xs text-slate-400">
            Dica: use o campo "O que mudaria no roteiro geral?" acima e peça
            "Sugira lugares para o dia {day.day_number}".
          </div>
        </div>
      ) : (

      <Droppable
        droppableId={String(day.id)}
        direction="horizontal"
        type="ITEM"
      >
          {(provided) => (
            <div
              ref={provided.innerRef}
              {...provided.droppableProps}
              className="relative flex gap-4 overflow-x-auto overflow-y-hidden scrollbar-thin pb-4 snap-x snap-mandatory"
              /* Native horizontal scroll replaces Swiper — the old carousel
                 library was consuming pointer events before @hello-pangea/dnd
                 could register a drag start, which meant "grab a card and
                 move it" literally never worked. Native overflow-x-auto +
                 CSS scroll-snap gives the same UX (momentum, mousewheel,
                 keyboard arrows via focus) without fighting dnd. */
            >
              {items.map((item, idx) => (
                <Draggable
                  key={item.id}
                  draggableId={String(item.id)}
                  index={idx}
                >
                  {(dragProvided, snapshot) => (
                    <div
                      ref={dragProvided.innerRef}
                      {...dragProvided.draggableProps}
                      {...dragProvided.dragHandleProps}
                      style={{
                        ...dragProvided.draggableProps.style,
                        width: 320,
                        flexShrink: 0,
                      }}
                      className="snap-start cursor-grab active:cursor-grabbing"
                    >
                      <ItemCard
                        item={item}
                        isDragging={snapshot.isDragging}
                        onClick={
                          onItemClick
                            ? () => onItemClick(item.id, day.id)
                            : undefined
                        }
                        onSwap={
                          onSwapItem
                            ? () => onSwapItem(item.id, day.id)
                            : undefined
                        }
                        onDelete={
                          onDeleteItem
                            ? () => {
                                if (
                                  window.confirm(
                                    `Remover "${item.name}" do roteiro?`
                                  )
                                ) {
                                  onDeleteItem(item.id, day.id);
                                }
                              }
                            : undefined
                        }
                      />
                    </div>
                  )}
                </Draggable>
              ))}
              {provided.placeholder}
            </div>
          )}
      </Droppable>
      )}

      {/* Subtle progress bar at bottom — minimal */}
      <div className="mt-8 px-2">
        <div className="h-1 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              backgroundColor: BRAND.primary,
              width:
                allDays.length > 1
                  ? `${((activeDayIdx + 1) / allDays.length) * 100}%`
                  : "100%",
            }}
          />
        </div>
      </div>
    </div>
    </DragDropContext>
  );
}
