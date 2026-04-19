import React, { useMemo, useRef, useState } from "react";
import { Swiper, SwiperSlide } from "swiper/react";
import { Navigation } from "swiper/modules";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import "swiper/css";
import "swiper/css/navigation";

const CATEGORY_COLORS = {
  restaurant: "#F59E0B",
  restaurante: "#F59E0B",
  food: "#F59E0B",
  attraction: "#10B981",
  atracao: "#10B981",
  atração: "#10B981",
  museum: "#8B5CF6",
  bar: "#EF4444",
  beach: "#06B6D4",
  praia: "#06B6D4",
  shopping: "#EC4899",
  nature: "#10B981",
  default: "#FF5722",
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

function ItemCard({ item, dragHandleProps, isDragging }) {
  const color = categoryColor(item.category);
  const icon = categoryIcon(item.category);
  const image =
    item.photo_url ||
    (item.photos && item.photos[0]) ||
    placeholderImage(item.name, color);

  return (
    <div
      className={`flex flex-col bg-white rounded-2xl overflow-hidden shadow-sm border transition ${
        isDragging ? "shadow-2xl border-orange-400 scale-[1.02]" : "border-gray-200"
      }`}
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
      {/* Day header with date pill */}
      <div className="flex items-baseline gap-4 mb-6 px-2">
        <div
          className="px-4 py-2 rounded-full text-white font-bold text-sm tracking-wide"
          style={{ backgroundColor: "#FF5722" }}
        >
          DIA {day.day_number}
        </div>
        {day.city && (
          <h2 className="text-2xl font-bold text-gray-900">{day.city}</h2>
        )}
        <span className="text-sm text-gray-500 ml-auto">
          {items.length} {items.length === 1 ? "lugar" : "lugares"}
        </span>
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
                modules={[Navigation]}
                slidesPerView="auto"
                spaceBetween={16}
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

      {/* Day timeline (dots + labels) */}
      <div className="mt-8 relative">
        <div className="absolute top-3 left-0 right-0 h-0.5 bg-gray-200" />
        <div className="flex justify-between relative">
          {daysWithItems.map((d, idx) => {
            const active = idx === activeDayIdx;
            const past = idx < activeDayIdx;
            return (
              <button
                key={d.id}
                onClick={() => setActiveDayIdx(idx)}
                className="flex flex-col items-center flex-1 group"
              >
                <div
                  className={`w-6 h-6 rounded-full border-4 transition-all z-10 ${
                    active
                      ? "bg-orange-500 border-orange-500 scale-110"
                      : past
                        ? "bg-orange-500 border-orange-500"
                        : "bg-white border-gray-300 group-hover:border-orange-400"
                  }`}
                />
                <div
                  className={`mt-2 text-xs font-semibold transition-colors ${
                    active ? "text-orange-600" : "text-gray-500"
                  }`}
                >
                  {d.city || `Dia ${d.day_number}`}
                </div>
                <div className="text-xs text-gray-400">Dia {d.day_number}</div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
