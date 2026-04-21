import { useEffect, useState } from "react";
import { useLanguage } from "../../i18n/LanguageContext";
import { fetchConflicts } from "../../api/conflicts";
import ConflictResolutionModal from "../modals/ConflictResolutionModal";

/**
 * Phase 5.4 — trip-wide banner that surfaces any pending conflict_alerts
 * on the trip's day_plans. Polls on mount + whenever the parent increments
 * the `refreshKey` prop (typically after a refine call finishes).
 *
 * When the user clicks "Resolver", the modal opens and resolves one alert
 * at a time. After each resolution the banner re-fetches so its counter
 * and the modal's stack of alerts stay in sync.
 */
export default function ConflictsBanner({ tripId, refreshKey = 0 }) {
  const { lang } = useLanguage();
  const pt = lang === "pt-BR";
  const [conflicts, setConflicts] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);

  async function load() {
    if (!tripId) return;
    try {
      const list = await fetchConflicts(tripId);
      setConflicts(list);
    } catch (e) {
      // Silent — missing endpoint on old backends shouldn't crash the page.
      setConflicts([]);
    }
  }

  useEffect(() => {
    load();
  }, [tripId, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-close the modal once the queue is empty so a future refine doesn't
  // reopen it accidentally.
  useEffect(() => {
    if (conflicts.length === 0 && modalOpen) setModalOpen(false);
  }, [conflicts.length, modalOpen]);

  if (!conflicts.length) return null;

  const high = conflicts.filter((c) => c.severity === "high").length;

  return (
    <>
      <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="text-lg">⚠️</div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-amber-900">
              {conflicts.length === 1
                ? pt ? "1 decisão pendente no seu roteiro" : "1 pending decision on your itinerary"
                : pt
                ? `${conflicts.length} decisões pendentes no seu roteiro`
                : `${conflicts.length} pending decisions on your itinerary`}
            </p>
            <p className="text-xs text-amber-800/80 truncate">
              {pt
                ? "Um refinamento mexeu em lugares vindos dos seus vídeos. Confirme o que fazer."
                : "A refine touched places from your videos. Confirm what to do."}
              {high > 0 && (
                <span className="ml-1 font-semibold">
                  ({high} {pt ? "de alta prioridade" : "high-priority"})
                </span>
              )}
            </p>
          </div>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="flex-shrink-0 px-3 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-semibold hover:bg-amber-600 transition"
        >
          {pt ? "Resolver" : "Resolve"}
        </button>
      </div>

      {modalOpen && (
        <ConflictResolutionModal
          tripId={tripId}
          conflicts={conflicts}
          onResolved={async () => {
            await load();
            // Modal stays open if more remain; close when the next `conflicts`
            // render is empty.
          }}
          onClose={() => setModalOpen(false)}
        />
      )}
    </>
  );
}
