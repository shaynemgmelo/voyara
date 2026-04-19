import React, { useMemo, useRef, useState } from "react";
import { Swiper, SwiperSlide } from "swiper/react";
import { Navigation, Mousewheel, FreeMode, Keyboard } from "swiper/modules";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import "swiper/css";
import "swiper/css/navigation";
import "swiper/css/free-mode";

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

function ItemCard({ item, dragHandleProps, isDragging }) {
  const color = categoryColor(item.category);
  const icon = categoryIcon(item.category);
  const image =
    item.photo_url ||
    (item.photos && item.photos[0]) ||
    placeholderImage(item.name, color);
  const badge = sourceBadge(item.source, item.source_url);

  return (
    <div
      className={`flex flex-col rounded-2xl overflow-hidden shadow-sm border transition ${
        isDragging
          ? "shadow-2xl scale-[1.02] border-emerald-400"
          : "border-emerald-100 hover:border-emerald-200"
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
        {dragHandleProps && (
          <div
            {...dragHandleProps}
            className="absolute top-2 right-2 w-8 h-8 rounded-lg bg-black/60 hover:bg-black/80 backdrop-blur-sm flex items-center justify-center cursor-grab active:cursor-grabbing"
            title="Arrastar"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="9" cy="5" r="1" />
              <circle cx="9" cy="12" r="1" />
              <circle cx="9" cy="19" r="1" />
              <circle cx="15" cy="5" r="1" />
              <circle cx="15" cy="12" r="1" />
              <circle cx="15" cy="19" r="1" />
            </svg>
          </div>
        )}
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

export default function TripTimeline({ dayPlans, onReorder }) {
  const [activeDayIdx, setActiveDayIdx] = useState(0);
  const swiperRefs = useRef({});

  const daysWithItems = useMemo(
    () => (dayPlans || []).filter((d) => (d.itinerary_items || []).length > 0),
    [dayPlans]
  );

  if (!daysWithItems.length) {
    return (
      <div className="text-center py-16 text-gray-500">
        <div className="text-5xl mb-3">📍</div>
        <p>Nenhum lugar adicionado ainda.</p>
      </div>
    );
  }

  const handleDragEnd = (result) => {
    if (!result.destination) return;
    if (result.source.index === result.destination.index) return;
    if (onReorder) {
      onReorder({
        dayPlanId: parseInt(result.source.droppableId, 10),
        fromIndex: result.source.index,
        toIndex: result.destination.index,
      });
    }
  };

  const day = daysWithItems[activeDayIdx];
  const items = day.itinerary_items || [];

  return (
    <div className="w-full">
      {/* Day tabs — all days side-by-side, scrollable on overflow */}
      <div className="mb-4 -mx-2 overflow-x-auto scrollbar-thin">
        <div className="flex items-center gap-2 px-2 pb-2 min-w-max">
          {daysWithItems.map((d, idx) => {
            const isActive = idx === activeDayIdx;
            const count = (d.itinerary_items || []).length;
            return (
              <button
                key={d.id}
                onClick={() => setActiveDayIdx(idx)}
                className={`group flex-shrink-0 flex items-center gap-2 px-4 py-2 rounded-full font-semibold text-sm transition-all ${
                  isActive
                    ? "text-white shadow-lg"
                    : "bg-white border border-slate-200 text-slate-600 hover:border-emerald-300 hover:text-slate-900"
                }`}
                style={
                  isActive
                    ? {
                        backgroundColor: BRAND.primary,
                        boxShadow: "0 10px 24px -8px rgba(16,185,129,0.55)",
                      }
                    : {}
                }
              >
                <span className="text-xs font-bold tracking-wide">
                  DIA {d.day_number}
                </span>
                {d.city ? (
                  <span className="opacity-80 font-normal">• {d.city}</span>
                ) : null}
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                    isActive
                      ? "bg-white/25 text-white"
                      : "bg-slate-100 text-slate-500"
                  }`}
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
          {items.length} {items.length === 1 ? "lugar" : "lugares"}{" "}
          {day.city ? `em ${day.city}` : ""}
        </div>
        <div className="text-xs" style={{ color: BRAND.textMuted }}>
          Arraste para navegar →
        </div>
      </div>

      {/* Cards carousel with drag & drop */}
      <DragDropContext onDragEnd={handleDragEnd}>
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
                grabCursor
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

      {/* Subtle progress bar at bottom — minimal */}
      <div className="mt-8 px-2">
        <div className="h-1 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              backgroundColor: BRAND.primary,
              width:
                daysWithItems.length > 1
                  ? `${((activeDayIdx + 1) / daysWithItems.length) * 100}%`
                  : "100%",
            }}
          />
        </div>
      </div>
    </div>
  );
}
