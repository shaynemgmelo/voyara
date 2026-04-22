import { useState, useMemo } from "react";
import { useLanguage } from "../../i18n/LanguageContext";

/**
 * Multi-base pause modal — appears when the destination classifier detected
 * 2+ base cities for the trip (e.g. Bangkok + Chiang Mai + Phuket + Koh Lipe
 * across 15 days in Thailand). The build is paused server-side until the
 * user decides (a) which cities to include and (b) how many days in each.
 *
 * UX:
 *   - One row per detected city: toggle + slider + day count.
 *   - Sliders auto-rebalance proportionally across the OTHER selected cities
 *     so the sum always equals num_days. Unchecked cities are frozen at 0.
 *   - Continue is disabled if selection is empty or sum != num_days
 *     (defensive — auto-rebalance should keep sum correct at all times).
 *   - No cancel button: the pause is blocking, matching the needs_destination
 *     pattern. The user HAS to make a call.
 *
 * Props:
 *   baseCities              string[] — detected cities in classifier order
 *   numDays                 number   — trip length
 *   initialSelectedCities   string[] — persisted selection (defaults to all)
 *   initialDistribution     Record<string, number> — persisted days per city
 *   onSubmit                async (selectedCities, dayDistribution) => void
 */

function rebalance(days, selectedSet, movedCity, newValue, numDays) {
  const clamped = Math.max(0, Math.min(numDays, newValue));
  const others = [...selectedSet].filter((c) => c !== movedCity);

  if (others.length === 0) {
    return { ...days, [movedCity]: numDays };
  }

  const remaining = numDays - clamped;
  if (remaining < 0) {
    return days;
  }

  const currentOthersTotal = others.reduce((s, c) => s + (days[c] || 0), 0);

  let nextOthers;
  if (currentOthersTotal === 0) {
    const base = Math.floor(remaining / others.length);
    const extra = remaining - base * others.length;
    nextOthers = Object.fromEntries(
      others.map((c, i) => [c, base + (i < extra ? 1 : 0)]),
    );
  } else {
    const raw = others.map((c) => ({
      city: c,
      exact: ((days[c] || 0) / currentOthersTotal) * remaining,
    }));
    const floored = raw.map((r) => ({ ...r, val: Math.floor(r.exact) }));
    let leftover = remaining - floored.reduce((s, r) => s + r.val, 0);
    floored.sort((a, b) => (b.exact - b.val) - (a.exact - a.val));
    for (let i = 0; i < leftover && i < floored.length; i++) {
      floored[i].val += 1;
    }
    nextOthers = Object.fromEntries(floored.map((r) => [r.city, r.val]));
  }

  // Zero out any city that's not in the selected set (defensive).
  const result = { ...days, [movedCity]: clamped, ...nextOthers };
  Object.keys(result).forEach((c) => {
    if (!selectedSet.has(c)) result[c] = 0;
  });
  return result;
}

export default function CityDistributionModal({
  baseCities,
  numDays,
  initialSelectedCities,
  initialDistribution,
  onSubmit,
}) {
  const { lang } = useLanguage();
  const pt = lang === "pt-BR";

  const [selected, setSelected] = useState(
    () => new Set(initialSelectedCities || baseCities),
  );
  const [days, setDays] = useState(() => {
    const base = {};
    (baseCities || []).forEach((c) => {
      base[c] = initialDistribution?.[c] ?? 0;
    });
    return base;
  });
  const [submitting, setSubmitting] = useState(false);

  const total = useMemo(
    () => Object.entries(days).reduce(
      (s, [c, v]) => (selected.has(c) ? s + (v || 0) : s), 0,
    ),
    [days, selected],
  );
  const isValid = total === numDays && selected.size > 0;

  const handleSliderChange = (city, valueStr) => {
    if (!selected.has(city)) return;
    const value = parseInt(valueStr, 10);
    if (Number.isNaN(value)) return;
    setDays((prev) => rebalance(prev, selected, city, value, numDays));
  };

  const handleToggle = (city) => {
    const nextSelected = new Set(selected);
    if (nextSelected.has(city)) {
      if (nextSelected.size <= 1) return; // at least 1 city required
      nextSelected.delete(city);
      setDays((prev) => {
        const withZero = { ...prev, [city]: 0 };
        // Redistribute the freed days across the remaining selected cities.
        const others = [...nextSelected];
        if (others.length === 0) return withZero;
        const currentOthersTotal = others.reduce(
          (s, c) => s + (withZero[c] || 0), 0,
        );
        // Use rebalance targeting any remaining city — it will fix the sum.
        const anchor = others[0];
        const anchorCurrent = withZero[anchor] || 0;
        return rebalance(withZero, nextSelected, anchor, anchorCurrent, numDays);
      });
    } else {
      nextSelected.add(city);
      setDays((prev) => {
        // Give the re-added city a fair starting share, then rebalance.
        const share = Math.max(1, Math.floor(numDays / nextSelected.size));
        return rebalance(prev, nextSelected, city, share, numDays);
      });
    }
    setSelected(nextSelected);
  };

  const handleSubmit = async () => {
    if (!isValid || submitting) return;
    setSubmitting(true);
    try {
      const orderedSelected = (baseCities || []).filter((c) => selected.has(c));
      const filteredDistribution = {};
      orderedSelected.forEach((c) => {
        filteredDistribution[c] = days[c] || 0;
      });
      await onSubmit(orderedSelected, filteredDistribution);
    } finally {
      setSubmitting(false);
    }
  };

  const dayUnit = (n) =>
    n === 1
      ? (pt ? "dia" : "day")
      : (pt ? "dias" : "days");

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-3xl shadow-2xl max-w-lg w-full p-8 space-y-5 border-2 border-amber-200 max-h-[90vh] overflow-y-auto">
        <div className="text-center">
          <div className="text-4xl mb-2">🗺️</div>
          <h3 className="text-xl font-bold text-gray-900">
            {pt
              ? `Como dividir seus ${numDays} dias?`
              : `How to split your ${numDays} days?`}
          </h3>
          <p className="text-sm text-gray-500 mt-2 leading-relaxed">
            {pt
              ? `Detectamos ${baseCities.length} cidades na sua viagem. Ajuste quantos dias em cada uma — ou desmarque as que você não quer visitar.`
              : `We detected ${baseCities.length} cities in your trip. Adjust how many days in each — or uncheck the ones you don't want.`}
          </p>
        </div>

        <div className="space-y-3">
          {baseCities.map((city) => {
            const isSelected = selected.has(city);
            const value = days[city] || 0;
            return (
              <div
                key={city}
                className={`flex items-center gap-3 p-3 rounded-xl border-2 transition ${
                  isSelected
                    ? "border-amber-200 bg-amber-50/50"
                    : "border-gray-200 bg-gray-50 opacity-60"
                }`}
              >
                <button
                  type="button"
                  onClick={() => handleToggle(city)}
                  aria-pressed={isSelected}
                  aria-label={city}
                  className={`flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition ${
                    isSelected
                      ? "bg-amber-500 border-amber-500"
                      : "bg-white border-gray-300"
                  }`}
                >
                  {isSelected && (
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold text-gray-900 truncate">
                      {city}
                    </span>
                    <span className="text-xs font-medium text-gray-600 flex-shrink-0">
                      {value} {dayUnit(value)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={numDays}
                    value={value}
                    onChange={(e) => handleSliderChange(city, e.target.value)}
                    disabled={!isSelected || submitting}
                    aria-label={`${city} days`}
                    className="w-full mt-1.5 accent-amber-500 disabled:opacity-40 disabled:cursor-not-allowed"
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-gray-100">
          <span
            className={`text-sm font-semibold ${
              isValid ? "text-emerald-600" : "text-red-500"
            }`}
          >
            {pt
              ? `${total} de ${numDays} ${dayUnit(numDays)}${isValid ? " ✓" : ""}`
              : `${total} of ${numDays} ${dayUnit(numDays)}${isValid ? " ✓" : ""}`}
          </span>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!isValid || submitting}
            className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold shadow-md transition"
          >
            {submitting
              ? (pt ? "Continuando..." : "Continuing...")
              : (pt ? "Continuar" : "Continue")}
          </button>
        </div>

        <p className="text-[11px] text-gray-400 text-center leading-relaxed">
          {pt
            ? "A IA vai gerar o roteiro respeitando as cidades e dias que você escolher aqui."
            : "The AI will generate the itinerary honoring the cities and days you pick here."}
        </p>
      </div>
    </div>
  );
}
