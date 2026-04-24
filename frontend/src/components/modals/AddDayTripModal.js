import { useEffect, useState } from "react";
import { useLanguage } from "../../i18n/LanguageContext";
import { getDayTripSuggestions } from "../../data/dayTripSuggestions";
import { fetchDayTripSuggestions } from "../../api/trips";

// Modal opened from the CityTabs "+ day-trip" button. Shows curated
// suggestions for the main city (e.g. Buenos Aires → Tigre / Colonia /
// San Antonio de Areco) plus a free-text input. Submitting wires
// through to the parent's onSubmit which fires a refine call —
// orchestrator.refine_itinerary already detects day-trip intent and
// runs in surgical mode.
export default function AddDayTripModal({
  mainCity,
  mainCountry = "",
  excludeCities = [],
  onSubmit,
  onClose,
}) {
  const { lang } = useLanguage();
  const pt = lang === "pt-BR";

  const [customCity, setCustomCity] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [liveSuggestions, setLiveSuggestions] = useState([]);
  const [loadingLive, setLoadingLive] = useState(false);

  useEffect(() => {
    if (!mainCity) return;
    let cancelled = false;
    setLoadingLive(true);
    fetchDayTripSuggestions(mainCity, mainCountry)
      .then((res) => {
        if (cancelled) return;
        setLiveSuggestions(Array.isArray(res?.suggestions) ? res.suggestions : []);
      })
      .catch(() => {
        if (cancelled) return;
        setLiveSuggestions([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingLive(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mainCity, mainCountry]);

  const excluded = new Set(excludeCities.map((c) => (c || "").toLowerCase()));
  // Merge: backend suggestions first (fresh, web-sourced), then curated
  // fallback for anything new. Dedupe by lower-case name.
  const merged = [];
  const seen = new Set();
  for (const name of [...liveSuggestions, ...getDayTripSuggestions(mainCity)]) {
    const key = (name || "").toLowerCase().trim();
    if (!key || seen.has(key) || excluded.has(key)) continue;
    seen.add(key);
    merged.push(name);
    if (merged.length >= 6) break;
  }
  const suggestions = merged;

  const submit = async (cityName) => {
    if (submitting) return;
    const value = (cityName || "").trim();
    if (!value) return;
    setSubmitting(true);
    try {
      await onSubmit(value);
      onClose();
    } catch {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl shadow-2xl max-w-md w-full p-7 space-y-5 border-2 border-emerald-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h2 className="text-xl font-bold text-gray-900">
            {pt ? "Adicionar day-trip" : "Add a day-trip"}
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            {pt
              ? `Um dia inteiro em uma cidade próxima${mainCity ? ` a ${mainCity}` : ""}.`
              : `One full day in a city near${mainCity ? ` ${mainCity}` : "by"}.`}
          </p>
        </div>

        {(loadingLive || suggestions.length > 0) && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-2">
              {pt ? "Sugestões populares" : "Popular picks"}
              {loadingLive && (
                <span className="text-gray-400 normal-case font-normal">
                  {pt ? "buscando..." : "searching..."}
                </span>
              )}
            </p>
            {loadingLive && suggestions.length === 0 ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="h-10 bg-emerald-50 border border-emerald-100 rounded-lg animate-pulse"
                  />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={submitting}
                    onClick={() => submit(s)}
                    className="text-left bg-emerald-50 hover:bg-emerald-100 disabled:opacity-50 border border-emerald-200 rounded-lg px-4 py-2.5 text-sm font-medium text-emerald-800 transition-colors"
                  >
                    🚶 {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            {pt ? "Outro lugar" : "Somewhere else"}
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={customCity}
              onChange={(e) => setCustomCity(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit(customCity);
                }
              }}
              disabled={submitting}
              placeholder={pt ? "Ex: Tigre" : "e.g. Tigre"}
              className="flex-1 bg-gray-50 border border-gray-300 rounded-lg px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <button
              type="button"
              disabled={submitting || !customCity.trim()}
              onClick={() => submit(customCity)}
              className="bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white font-medium px-4 py-2.5 rounded-lg text-sm transition-colors"
            >
              {pt ? "Adicionar" : "Add"}
            </button>
          </div>
        </div>

        <div className="flex justify-end pt-1">
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            className="text-sm text-gray-500 hover:text-gray-900 disabled:opacity-50"
          >
            {pt ? "Cancelar" : "Cancel"}
          </button>
        </div>

        {submitting && (
          <p className="text-xs text-gray-500 text-center">
            {pt ? "Atualizando o roteiro..." : "Updating itinerary..."}
          </p>
        )}
      </div>
    </div>
  );
}
