import { useState } from "react";
import { useLanguage } from "../../i18n/LanguageContext";
import { resolveConflict } from "../../api/conflicts";

/**
 * Phase 5.3 — modal that asks the user what to do with a conflict alert
 * raised by the refine pipeline or landmark audit.
 *
 * Props:
 *   tripId: number
 *   conflicts: array of alerts (from fetchConflicts). Only the FIRST is
 *     shown — users resolve one at a time. The parent decides when to
 *     re-open with the next.
 *   onResolved(updatedConflict, resolution): called after a successful POST,
 *     so the parent can refresh the list and optionally trigger a
 *     follow-up refine when resolution === "replace".
 *   onClose(): fires on Esc / backdrop / "Decidir depois".
 */
export default function ConflictResolutionModal({
  tripId,
  conflicts,
  onResolved,
  onClose,
}) {
  const { lang } = useLanguage();
  const pt = lang === "pt-BR";
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  if (!conflicts || conflicts.length === 0) return null;
  const current = conflicts[0];
  const remaining = conflicts.length - 1;

  const isLockedRemoval = current.type === "locked_item_removal_attempt";
  const itemName = current.item_name || (pt ? "este lugar" : "this place");

  // Find the alert's index within its day_plan. The controller expects
  // `alert_index` which is the position in that day's conflict_alerts array,
  // not the flat list — but the backend returns them in order, so we count
  // how many alerts on the same day come before this one.
  const alertIndex = (() => {
    let idx = 0;
    for (const c of conflicts) {
      if (c.day_plan_id !== current.day_plan_id) continue;
      if (c === current) return idx;
      idx += 1;
    }
    return 0;
  })();

  async function handleChoice(resolution) {
    setSubmitting(true);
    setError(null);
    try {
      await resolveConflict(tripId, {
        dayPlanId: current.day_plan_id,
        alertIndex,
        resolution,
      });
      onResolved?.(current, resolution);
    } catch (e) {
      setError(e.message || (pt ? "Falha ao salvar" : "Failed to save"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="text-2xl">{isLockedRemoval ? "🔒" : "⚠️"}</div>
          <div className="flex-1">
            <h3 className="font-bold text-gray-900 text-base">
              {isLockedRemoval
                ? pt ? "Lugar do vídeo afetado" : "Video-sourced place affected"
                : pt ? "Conflito no roteiro" : "Itinerary conflict"}
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {pt ? "Dia" : "Day"} {current.day_number}
              {current.city ? ` • ${current.city}` : ""}
              {remaining > 0 && (
                <>
                  {" • "}
                  <span className="font-medium text-gray-700">
                    {remaining} {pt ? "restante(s)" : "more pending"}
                  </span>
                </>
              )}
            </p>
          </div>
        </div>

        <div className="bg-blue-50/60 border border-blue-100 rounded-xl p-3">
          <p className="text-sm text-gray-900 font-medium">{itemName}</p>
          {current.message && (
            <p className="text-xs text-gray-600 mt-1">{current.message}</p>
          )}
        </div>

        {error && (
          <div className="text-xs text-red-600 bg-red-50 rounded px-3 py-2">
            {error}
          </div>
        )}

        <div className="space-y-2">
          <button
            onClick={() => handleChoice("keep")}
            disabled={submitting}
            className="w-full px-4 py-2.5 rounded-xl text-sm font-semibold bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50 transition"
          >
            {pt ? "Manter no roteiro" : "Keep it"}
          </button>
          <button
            onClick={() => handleChoice("replace")}
            disabled={submitting}
            className="w-full px-4 py-2.5 rounded-xl text-sm font-semibold bg-coral-50 text-coral-700 hover:bg-coral-100 disabled:opacity-50 transition"
          >
            {pt ? "Substituir por outra coisa" : "Replace with something else"}
          </button>
          <button
            onClick={() => handleChoice("remove")}
            disabled={submitting}
            className="w-full px-4 py-2.5 rounded-xl text-sm font-semibold bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-50 transition"
          >
            {pt ? "Remover do roteiro" : "Remove from itinerary"}
          </button>
        </div>

        <button
          onClick={onClose}
          disabled={submitting}
          className="w-full text-xs text-gray-500 hover:text-gray-700 py-1.5 transition"
        >
          {pt ? "Decidir depois" : "Decide later"}
        </button>
      </div>
    </div>
  );
}
