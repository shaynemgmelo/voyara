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

  const [step, setStep] = useState("city"); // "city" | "mode" | "confirm-locked"
  const [pickedCity, setPickedCity] = useState("");
  const [customCity, setCustomCity] = useState("");
  const [chosenMode, setChosenMode] = useState("extend"); // "replace" | "extend"
  const [chosenDay, setChosenDay] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [lockedNames, setLockedNames] = useState(null);
  const [pendingLockedDay, setPendingLockedDay] = useState(null); // {day_number, items}
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

  const submitWithOpts = async (opts) => {
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await onSubmit(pickedCity, opts);
      onClose();
    } catch (err) {
      const data = err?.data || {};
      if (err?.status === 409 && data?.error === "day_has_locked_items") {
        // Open the explicit consent step before touching video items.
        const dp = dayPlans.find((d) => d.day_number === opts.targetDayNumber);
        setPendingLockedDay({
          day_number: opts.targetDayNumber,
          items: (dp?.itinerary_items || []).filter(
            (it) => (it.origin === "extracted_from_video") || (it.source === "link"),
          ),
          locked_names: Array.isArray(data?.locked_names) ? data.locked_names : [],
        });
        setStep("confirm-locked");
      } else {
        setErrorMsg(err?.message || (pt ? "Falha ao adicionar day-trip." : "Failed to add day-trip."));
      }
      setSubmitting(false);
    }
  };

  const confirm = async () => {
    if (submitting) return;
    setLockedNames(null);
    const opts = chosenMode === "replace"
      ? { mode: "replace", targetDayNumber: chosenDay }
      : { mode: "extend" };
    await submitWithOpts(opts);
  };

  const confirmForce = async () => {
    if (submitting) return;
    await submitWithOpts({
      mode: "replace",
      targetDayNumber: pendingLockedDay?.day_number,
      forceDeleteLocked: true,
    });
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
                    const lockedCount = (dp.itinerary_items || []).filter(
                      (it) => (it.origin === "extracted_from_video") || (it.source === "link"),
                    ).length;
                    return (
                      <label
                        key={dp.id}
                        className={`block rounded-lg border p-3 cursor-pointer transition-colors ${
                          selected
                            ? "border-amber-400 bg-amber-50"
                            : "border-gray-200 hover:border-gray-300 bg-white"
                        }`}
                      >
                        <input
                          type="radio"
                          name="targetDay"
                          value={dp.day_number}
                          checked={selected}
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
                              title={pt
                                ? `${lockedCount} item(s) deste dia vieram do vídeo — confirmação extra antes de apagar`
                                : `${lockedCount} item(s) came from the video — extra confirmation before delete`}
                            >
                              🔒 {lockedCount} {pt ? "do vídeo" : "from video"}
                            </span>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                  {pt
                    ? "⚠️ Os items deste dia serão removidos. Se o dia tiver items do vídeo, vamos pedir confirmação extra antes de apagar."
                    : "⚠️ This day's items will be removed. If the day has video items, we'll ask for extra confirmation."}
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

        {step === "confirm-locked" && pendingLockedDay && (
          <>
            <div>
              <h2 className="text-xl font-bold text-gray-900">
                {pt
                  ? `Apagar items do vídeo do dia ${pendingLockedDay.day_number}?`
                  : `Delete video items from day ${pendingLockedDay.day_number}?`}
              </h2>
              <p className="text-sm text-gray-600 mt-1">
                {pt
                  ? `O dia ${pendingLockedDay.day_number} tem ${(pendingLockedDay.locked_names || []).length} item(s) que vieram do vídeo. Eles serão removidos pra dar lugar a ${pickedCity}.`
                  : `Day ${pendingLockedDay.day_number} has ${(pendingLockedDay.locked_names || []).length} item(s) from the video. They will be removed to make room for ${pickedCity}.`}
              </p>
            </div>

            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-2">
                {pt ? "Items que serão apagados" : "Items to be deleted"}
              </p>
              <ul className="space-y-1">
                {(pendingLockedDay.locked_names || []).map((n, i) => (
                  <li key={i} className="text-sm text-red-700 flex items-center gap-2">
                    <span>📸</span>
                    <span>{n}</span>
                  </li>
                ))}
              </ul>
            </div>

            <p className="text-xs text-gray-500">
              {pt
                ? "Dica: cancele aqui pra arrastar esses items pra outros dias do roteiro antes de substituir. Eles não voltam depois."
                : "Tip: cancel here to drag these items to other days first. They won't come back after deletion."}
            </p>

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                disabled={submitting}
                onClick={() => {
                  setStep("mode");
                  setPendingLockedDay(null);
                  setErrorMsg(null);
                }}
                className="text-sm text-gray-500 hover:text-gray-900"
              >
                ← {pt ? "Voltar" : "Back"}
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={confirmForce}
                className="bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white font-medium px-5 py-2.5 rounded-lg text-sm transition-colors"
              >
                {submitting
                  ? (pt ? "Apagando..." : "Deleting...")
                  : (pt ? "Apagar e substituir" : "Delete and replace")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
