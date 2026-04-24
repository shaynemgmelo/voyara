import { useEffect, useState } from "react";
import { useLanguage } from "../../i18n/LanguageContext";
import { getDayTripSuggestions } from "../../data/dayTripSuggestions";
import { fetchDayTripSuggestions } from "../../api/trips";

// 2-step modal:
//   Step "city"  — pick the day-trip destination (suggestions + free text)
//   Step "mode"  — choose to REPLACE an existing day or EXTEND the trip by 1
//                   day. Replace asks which day; warns the user that the
//                   day's items will be deleted and offers cancel-to-drag.
//
// Backed by /add-day-trip (Haiku + Google Places, no Sonnet refine), so
// this never triggers the full-trip regeneration that nuked day 1 in
// trip 27.
export default function AddDayTripModal({
  mainCity,
  mainCountry = "",
  excludeCities = [],
  dayPlans = [],
  numDays = 0,
  onSubmit,   // async (city, { mode, targetDayNumber }) => void
  onClose,
}) {
  const { lang } = useLanguage();
  const pt = lang === "pt-BR";

  const [step, setStep] = useState("city"); // "city" | "mode"
  const [pickedCity, setPickedCity] = useState("");
  const [customCity, setCustomCity] = useState("");
  const [chosenMode, setChosenMode] = useState("extend"); // "replace" | "extend"
  const [chosenDay, setChosenDay] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [lockedNames, setLockedNames] = useState(null);
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

  const goToModeStep = (cityName) => {
    const value = (cityName || "").trim();
    if (!value) return;
    setPickedCity(value);
    setErrorMsg(null);
    setLockedNames(null);
    // Default the chosen day to the LAST flexible day (most likely to
    // be a generic "free" day the user wouldn't mind replacing).
    if (dayPlans.length > 0) {
      const flexible = dayPlans.filter(
        (dp) => !((dp.itinerary_items || []).some(
          (it) => (it.origin === "extracted_from_video") || (it.source === "link"),
        )),
      );
      const fallback = flexible.length > 0 ? flexible[flexible.length - 1] : dayPlans[dayPlans.length - 1];
      setChosenDay(fallback?.day_number ?? null);
    }
    setStep("mode");
  };

  const confirm = async () => {
    if (submitting) return;
    setSubmitting(true);
    setErrorMsg(null);
    setLockedNames(null);
    try {
      const opts = chosenMode === "replace"
        ? { mode: "replace", targetDayNumber: chosenDay }
        : { mode: "extend" };
      await onSubmit(pickedCity, opts);
      onClose();
    } catch (err) {
      const data = err?.data || {};
      if (err?.status === 409 || data?.error === "day_has_locked_items") {
        setErrorMsg(
          data?.message
          || (pt
            ? "Esse dia tem items do vídeo. Apague-os manualmente ou arraste pra outro dia antes de substituir."
            : "That day has video-anchored items. Delete or move them manually before replacing."),
        );
        setLockedNames(Array.isArray(data?.locked_names) ? data.locked_names : null);
      } else {
        setErrorMsg(err?.message || (pt ? "Falha ao adicionar day-trip." : "Failed to add day-trip."));
      }
      setSubmitting(false);
    }
  };

  // Build a short summary line per day for the radio list.
  const summaryFor = (dp) => {
    const items = dp.itinerary_items || [];
    if (items.length === 0) return pt ? "(vazio)" : "(empty)";
    const names = items.slice(0, 3).map((it) => it.name).filter(Boolean);
    const tail = items.length > 3 ? ` +${items.length - 3}` : "";
    return names.join(", ") + tail;
  };

  const isLocked = (dp) =>
    (dp.itinerary_items || []).some(
      (it) => (it.origin === "extracted_from_video") || (it.source === "link"),
    );

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl shadow-2xl max-w-lg w-full p-7 space-y-5 border-2 border-emerald-200 max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {step === "city" && (
          <>
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
                        onClick={() => goToModeStep(s)}
                        className="text-left bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg px-4 py-2.5 text-sm font-medium text-emerald-800 transition-colors"
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
                      goToModeStep(customCity);
                    }
                  }}
                  placeholder={pt ? "Ex: Tigre" : "e.g. Tigre"}
                  className="flex-1 bg-gray-50 border border-gray-300 rounded-lg px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <button
                  type="button"
                  disabled={!customCity.trim()}
                  onClick={() => goToModeStep(customCity)}
                  className="bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white font-medium px-4 py-2.5 rounded-lg text-sm transition-colors"
                >
                  {pt ? "Continuar" : "Continue"}
                </button>
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={onClose}
                className="text-sm text-gray-500 hover:text-gray-900"
              >
                {pt ? "Cancelar" : "Cancel"}
              </button>
            </div>
          </>
        )}

        {step === "mode" && (
          <>
            <div>
              <h2 className="text-xl font-bold text-gray-900">
                {pt
                  ? `Como adicionar ${pickedCity}?`
                  : `How to add ${pickedCity}?`}
              </h2>
              <p className="text-sm text-gray-500 mt-1">
                {pt
                  ? "Escolha se você quer trocar um dia existente ou estender a viagem em +1 dia."
                  : "Pick whether to replace an existing day or extend the trip by 1 day."}
              </p>
            </div>

            <div className="space-y-3">
              {/* Extend option */}
              <label
                className={`block rounded-xl border-2 p-4 cursor-pointer transition-colors ${
                  chosenMode === "extend"
                    ? "border-emerald-500 bg-emerald-50"
                    : "border-gray-200 hover:border-gray-300 bg-white"
                }`}
              >
                <input
                  type="radio"
                  name="mode"
                  value="extend"
                  checked={chosenMode === "extend"}
                  onChange={() => setChosenMode("extend")}
                  className="sr-only"
                />
                <div className="flex items-start gap-3">
                  <div className="text-xl">➕</div>
                  <div className="flex-1">
                    <div className="font-semibold text-gray-900 text-sm">
                      {pt
                        ? `Adicionar +1 dia (${numDays} → ${numDays + 1})`
                        : `Add +1 day (${numDays} → ${numDays + 1})`}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      {pt
                        ? `Mantém os ${numDays} dias atuais intactos. ${pickedCity} vira o dia ${numDays + 1}.`
                        : `Keeps your current ${numDays} days untouched. ${pickedCity} becomes day ${numDays + 1}.`}
                    </p>
                  </div>
                </div>
              </label>

              {/* Replace option */}
              <label
                className={`block rounded-xl border-2 p-4 cursor-pointer transition-colors ${
                  chosenMode === "replace"
                    ? "border-amber-500 bg-amber-50"
                    : "border-gray-200 hover:border-gray-300 bg-white"
                }`}
              >
                <input
                  type="radio"
                  name="mode"
                  value="replace"
                  checked={chosenMode === "replace"}
                  onChange={() => setChosenMode("replace")}
                  className="sr-only"
                />
                <div className="flex items-start gap-3">
                  <div className="text-xl">🔁</div>
                  <div className="flex-1">
                    <div className="font-semibold text-gray-900 text-sm">
                      {pt ? "Trocar 1 dia existente" : "Replace 1 existing day"}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      {pt
                        ? `Os items do dia escolhido serão removidos e ${pickedCity} ocupa o dia inteiro.`
                        : `The chosen day's items will be removed and ${pickedCity} takes the whole day.`}
                    </p>
                  </div>
                </div>
              </label>
            </div>

            {/* Day picker — only when replace is selected */}
            {chosenMode === "replace" && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  {pt ? "Qual dia substituir?" : "Which day to replace?"}
                </p>
                <div className="space-y-1.5 max-h-56 overflow-auto">
                  {dayPlans.map((dp) => {
                    const locked = isLocked(dp);
                    const selected = chosenDay === dp.day_number;
                    return (
                      <label
                        key={dp.id}
                        className={`block rounded-lg border p-3 transition-colors ${
                          locked
                            ? "border-gray-200 bg-gray-50 cursor-not-allowed opacity-60"
                            : selected
                            ? "border-amber-400 bg-amber-50 cursor-pointer"
                            : "border-gray-200 hover:border-gray-300 bg-white cursor-pointer"
                        }`}
                      >
                        <input
                          type="radio"
                          name="targetDay"
                          value={dp.day_number}
                          checked={selected}
                          disabled={locked}
                          onChange={() => setChosenDay(dp.day_number)}
                          className="sr-only"
                        />
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-semibold text-gray-900">
                              {pt ? `Dia ${dp.day_number}` : `Day ${dp.day_number}`}
                              {dp.city && (
                                <span className="text-gray-500 font-normal">
                                  {" "}· {dp.city}
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-gray-500 truncate mt-0.5">
                              {summaryFor(dp)}
                            </div>
                          </div>
                          {locked && (
                            <span
                              className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 flex-shrink-0"
                              title={pt ? "Items deste dia vieram do vídeo — não podem ser apagados aqui" : "Items came from the video — cannot be replaced"}
                            >
                              🔒 {pt ? "Vídeo" : "Video"}
                            </span>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                  {pt
                    ? "⚠️ Os items deste dia serão removidos. Cancele aqui se quiser arrastar items pra outros dias antes de substituir."
                    : "⚠️ This day's items will be removed. Cancel here to drag items to other days first."}
                </p>
              </div>
            )}

            {errorMsg && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                {errorMsg}
                {lockedNames && lockedNames.length > 0 && (
                  <ul className="mt-2 list-disc list-inside text-xs text-red-600">
                    {lockedNames.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                disabled={submitting}
                onClick={() => {
                  setStep("city");
                  setErrorMsg(null);
                  setLockedNames(null);
                }}
                className="text-sm text-gray-500 hover:text-gray-900"
              >
                ← {pt ? "Voltar" : "Back"}
              </button>
              <button
                type="button"
                disabled={
                  submitting
                  || (chosenMode === "replace" && !chosenDay)
                }
                onClick={confirm}
                className="bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white font-medium px-5 py-2.5 rounded-lg text-sm transition-colors"
              >
                {submitting
                  ? (pt ? "Adicionando..." : "Adding...")
                  : chosenMode === "extend"
                  ? (pt ? `Adicionar dia ${numDays + 1}` : `Add day ${numDays + 1}`)
                  : (pt ? `Substituir dia ${chosenDay || "?"}` : `Replace day ${chosenDay || "?"}`)}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
