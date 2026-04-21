import React, { useMemo, useRef, useState } from "react";
import { Swiper, SwiperSlide } from "swiper/react";
import { Navigation, Mousewheel, FreeMode, Keyboard } from "swiper/modules";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import "swiper/css";
import "swiper/css/navigation";
import "swiper/css/free-mode";
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
  onItemClick,
  onDeleteItem,
  onSwapItem,
}) {
  const [activeDayIdx, setActiveDayIdx] = useState(0);
  const [isDraggingCard, setIsDraggingCard] = useState(false);
  const swiperRefs = useRef({});

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

  const handleDragStart = () => {
    setIsDraggingCard(true);
    // Disable Swiper grab during card drag
    Object.values(swiperRefs.current).forEach((s) => {
      if (s && !s.destroyed) s.allowTouchMove = false;
    });
  };

  const handleDragEnd = (result) => {
    setIsDraggingCard(false);
    Object.values(swiperRefs.current).forEach((s) => {
      if (s && !s.destroyed) s.allowTouchMove = true;
    });
    if (!result.destination) return;
    if (result.source.index === result.destination.index) return;
    if (!onReorder) return;

    // Build the full ordered itemIds array so the hook can persist + update
    // time slots. Before this the parent was passing (dayPlanId, fromIdx,
    // toIdx) to a function that expected (dayPlanId, itemIds[]) — drag-drop
    // never actually persisted to the backend.
    const dayPlanId = parseInt(result.source.droppableId, 10);
    const day = allDays.find((d) => d.id === dayPlanId);
    if (!day) return;
    const originalItems = day.itinerary_items || [];
    const reordered = Array.from(originalItems);
    const [moved] = reordered.splice(result.source.index, 1);
    reordered.splice(result.destination.index, 0, moved);
    const itemIds = reordered.map((i) => i.id);
    onReorder({ dayPlanId, itemIds });
  };

  const day = allDays[activeDayIdx];
  const items = day.itinerary_items || [];

  return (
    <div className="w-full">
      {/* Day tabs — all days side-by-side, scrollable on overflow */}
      <div className="mb-4 -mx-2 overflow-x-auto scrollbar-thin">
        <div className="flex items-center gap-2 px-2 pb-2 min-w-max">
          {allDays.map((d, idx) => {
            const isActive = idx === activeDayIdx;
            const count = (d.itinerary_items || []).length;
            // Same color the map paints the pins with — so the pill is an
            // instant key for "which pins on the map are mine".
            const dayColor = getDayColor(d.day_number);
            return (
              <button
                key={d.id}
                onClick={() => setActiveDayIdx(idx)}
                className={`group flex-shrink-0 flex items-center gap-2 px-4 py-2 rounded-full font-semibold text-sm transition-all ${
                  isActive
                    ? "text-white shadow-lg"
                    : "bg-white border text-slate-700 hover:shadow-sm"
                }`}
                style={
                  isActive
                    ? {
                        backgroundColor: dayColor,
                        boxShadow: `0 10px 24px -8px ${dayColor}88`,
                      }
                    : {
                        borderColor: `${dayColor}55`,
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
              </button>
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

      <DragDropContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <Droppable
          droppableId={String(day.id)}
          direction="horizontal"
          type="ITEM"
        >
          {(provided) => (
            <div
              ref={provided.innerRef}
              {...provided.droppableProps}
              className="relative"
            >
              <Swiper
                modules={[Navigation, Mousewheel, FreeMode, Keyboard]}
                slidesPerView="auto"
                spaceBetween={16}
                allowTouchMove={!isDraggingCard}
                simulateTouch={!isDraggingCard}
                freeMode={{
                  enabled: true,
                  momentum: true,
                  momentumRatio: 0.8,
                  momentumBounce: true,
                  sticky: false,
                }}
                mousewheel={{
                  enabled: true,
                  forceToAxis: true,
                  sensitivity: 1.2,
                  releaseOnEdges: true,
                }}
                keyboard={{ enabled: true, onlyInViewport: true }}
                grabCursor={!isDraggingCard}
                navigation={{
                  prevEl: `.timeline-prev-${day.id}`,
                  nextEl: `.timeline-next-${day.id}`,
                }}
                onSwiper={(s) => (swiperRefs.current[day.id] = s)}
                className="!pb-2"
              >
                {items.map((item, idx) => (
                  <SwiperSlide
                    key={item.id}
                    style={{ width: 320, height: "auto" }}
                  >
                    <Draggable draggableId={String(item.id)} index={idx}>
                      {(dragProvided, snapshot) => (
                        <div
                          ref={dragProvided.innerRef}
                          {...dragProvided.draggableProps}
                          style={{
                            ...dragProvided.draggableProps.style,
                            height: "100%",
                          }}
                        >
                          <ItemCard
                            item={item}
                            dragHandleProps={dragProvided.dragHandleProps}
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
                  </SwiperSlide>
                ))}
                {provided.placeholder}
              </Swiper>

              {/* Nav arrows */}
              <button
                className={`timeline-prev-${day.id} absolute left-0 top-1/2 -translate-y-1/2 -translate-x-4 w-10 h-10 rounded-full bg-white shadow-lg border border-gray-200 flex items-center justify-center z-10 hover:bg-gray-50 disabled:opacity-40`}
                aria-label="Anterior"
              >
                <span className="text-gray-700">‹</span>
              </button>
              <button
                className={`timeline-next-${day.id} absolute right-0 top-1/2 -translate-y-1/2 translate-x-4 w-10 h-10 rounded-full bg-white shadow-lg border border-gray-200 flex items-center justify-center z-10 hover:bg-gray-50 disabled:opacity-40`}
                aria-label="Próximo"
              >
                <span className="text-gray-700">›</span>
              </button>
            </div>
          )}
        </Droppable>
      </DragDropContext>
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
  );
}
