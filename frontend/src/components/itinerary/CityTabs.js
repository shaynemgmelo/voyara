import { useMemo } from "react";
import { useLanguage } from "../../i18n/LanguageContext";

// City pills bar shown above the itinerary timeline. Replaces the legacy
// region/Todas filter with a structured view of the trip's geography:
//
//   [ Todas ] [ Buenos Aires · 4d ] [ Tigre · 1d ✕ ] [ + day-trip ]
//
// - "Todas" filters to all days.
// - Main city pill (= traveler_profile.main_destination.city OR the city
//   with the most day_plans). Cannot be removed — it anchors the trip.
// - Day-trip pills are every other city in day_plans. Each can be removed
//   via the ✕ button (calls onRemoveDayTrip).
// - "+ day-trip" opens the AddDayTripModal (handled in the parent).
//
// Backwards-compat: if the trip has zero day_plans (still building) we
// still render the bar — useful for showing "+ day-trip" early.
export default function CityTabs({
  dayPlans,
  activeCity,
  onCityChange,
  mainCity,
  onAddDayTrip,
  onRemoveDayTrip,
}) {
  const { t, lang } = useLanguage();
  const pt = lang === "pt-BR";

  const { main, dayTrips } = useMemo(() => {
    const counts = new Map();
    for (const dp of dayPlans || []) {
      const c = dp.city || "";
      if (!c) continue;
      counts.set(c, (counts.get(c) || 0) + 1);
    }

    let mainName = mainCity || "";
    if (!mainName && counts.size > 0) {
      // Fallback: pick the city with the most days as "main".
      mainName = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    }
    const mainCount = counts.get(mainName) || 0;

    const others = [...counts.entries()]
      .filter(([c]) => c !== mainName)
      .map(([c, count]) => ({ city: c, days: count }));

    return {
      main: mainName ? { city: mainName, days: mainCount } : null,
      dayTrips: others,
    };
  }, [dayPlans, mainCity]);

  // Don't render the bar if we have NO main city AND no day-trips AND
  // no add handler — there's nothing to show.
  if (!main && dayTrips.length === 0 && !onAddDayTrip) return null;

  const dayLabel = (n) => `${n}${pt ? "d" : "d"}`;

  return (
    <div className="flex items-center gap-2 mb-4 flex-wrap">
      <button
        type="button"
        onClick={() => onCityChange(null)}
        className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
          activeCity === null
            ? "bg-coral-500 text-white"
            : "bg-gray-100 text-gray-600 hover:text-gray-900"
        }`}
      >
        {t("cityTabs.all")}
      </button>

      {main && (
        <button
          type="button"
          onClick={() => onCityChange(main.city)}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            activeCity === main.city
              ? "bg-coral-500 text-white"
              : "bg-gray-100 text-gray-600 hover:text-gray-900"
          }`}
        >
          <span>📍 {main.city}</span>
          {main.days > 0 && (
            <span className={`text-[10px] tabular-nums ${
              activeCity === main.city ? "text-white/80" : "text-gray-500"
            }`}>
              · {dayLabel(main.days)}
            </span>
          )}
        </button>
      )}

      {dayTrips.map((dt) => (
        <span
          key={dt.city}
          className={`group flex items-center rounded-md text-xs font-medium transition-colors overflow-hidden ${
            activeCity === dt.city
              ? "bg-emerald-500 text-white"
              : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
          }`}
        >
          <button
            type="button"
            onClick={() => onCityChange(dt.city)}
            className="flex items-center gap-1.5 pl-3 pr-2 py-1.5"
          >
            <span>🚶 {dt.city}</span>
            <span className={`text-[10px] tabular-nums ${
              activeCity === dt.city ? "text-white/80" : "text-emerald-600"
            }`}>
              · {dayLabel(dt.days)}
            </span>
          </button>
          {onRemoveDayTrip && (
            <button
              type="button"
              onClick={() => onRemoveDayTrip(dt.city)}
              title={pt ? `Remover day-trip a ${dt.city}` : `Remove day-trip to ${dt.city}`}
              aria-label={pt ? `Remover ${dt.city}` : `Remove ${dt.city}`}
              className={`px-2 py-1.5 text-[11px] transition-colors ${
                activeCity === dt.city
                  ? "text-white/70 hover:text-white hover:bg-emerald-600"
                  : "text-emerald-500 hover:text-red-600 hover:bg-red-50"
              }`}
            >
              ✕
            </button>
          )}
        </span>
      ))}

      {onAddDayTrip && main && (
        <button
          type="button"
          onClick={onAddDayTrip}
          className="px-3 py-1.5 text-xs font-medium rounded-md border border-dashed border-emerald-400 text-emerald-700 hover:bg-emerald-50 transition-colors"
        >
          + {pt ? "day-trip" : "day-trip"}
        </button>
      )}
    </div>
  );
}
