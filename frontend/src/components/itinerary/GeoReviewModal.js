import { useMemo, useState } from "react";
import { updateItem, deleteItem } from "../../api/itineraryItems";

/**
 * Detect "⚠️ ... {km}km ... Dia {N}" alerts that the backend places on
 * link-sourced outliers. These need user review.
 */
const GEO_ALERT_PATTERN = /⚠️.*?\d+\s*km.*Dia\s*(\d+)/i;

function isGeoAlert(alert) {
  return typeof alert === "string" && GEO_ALERT_PATTERN.test(alert);
}

function collectFlaggedItems(dayPlans) {
  const flagged = [];
  for (const dp of dayPlans || []) {
    for (const item of dp.itinerary_items || []) {
      const alerts = item.alerts || [];
      const geoAlert = alerts.find(isGeoAlert);
      if (geoAlert) {
        flagged.push({ item, dp, alertText: geoAlert });
      }
    }
  }
  return flagged;
}

export default function GeoReviewModal({ trip, onClose, onReload, pt = true }) {
  const flagged = useMemo(
    () => collectFlaggedItems(trip?.day_plans),
    [trip]
  );
  const [processingId, setProcessingId] = useState(null);

  if (!flagged.length) return null;

  const handleKeep = async ({ item, dp, alertText }) => {
    setProcessingId(item.id);
    try {
      // Remove the geo warning alert, keep everything else
      const cleanAlerts = (item.alerts || []).filter((a) => !isGeoAlert(a));
      await updateItem(trip.id, dp.id, item.id, { alerts: cleanAlerts });
      if (onReload) await onReload();
    } catch (e) {
      // swallow — keep modal open so user can retry
      // eslint-disable-next-line no-console
      console.error("Failed to keep item:", e);
    } finally {
      setProcessingId(null);
    }
  };

  const handleRemove = async ({ item, dp }) => {
    setProcessingId(item.id);
    try {
      await deleteItem(trip.id, dp.id, item.id);
      if (onReload) await onReload();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("Failed to remove item:", e);
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[88vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-display text-xl font-bold text-slate-900 tracking-tight">
                {pt
                  ? "Alguns lugares do seu link ficaram distantes"
                  : "Some places from your link ended up far"}
              </h2>
              <p className="text-sm text-slate-500 mt-0.5">
                {pt
                  ? "Como vieram do vídeo que você salvou, a gente não removeu sozinho. Decide você:"
                  : "Since they came from your saved video, we didn't remove them. You decide:"}
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 text-xl leading-none p-1 -m-1"
              aria-label="Fechar"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {flagged.map(({ item, dp, alertText }) => {
            const distanceMatch = alertText.match(/(\d+)\s*km/);
            const dist = distanceMatch ? distanceMatch[1] : "?";
            const isBusy = processingId === item.id;

            return (
              <div
                key={item.id}
                className="border border-amber-200 bg-amber-50 rounded-xl p-4"
              >
                <div className="flex items-start gap-3">
                  <div className="text-2xl flex-shrink-0">📍</div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-slate-900">
                      {item.name}
                    </div>
                    {item.address && (
                      <div className="text-sm text-slate-500 mt-0.5 truncate">
                        {item.address}
                      </div>
                    )}
                    <div className="text-sm text-amber-800 mt-2 leading-relaxed">
                      {pt ? (
                        <>
                          Fica a <strong>~{dist}km</strong> dos outros lugares do{" "}
                          <strong>Dia {dp.day_number}</strong>. Ir até lá vai
                          custar tempo de deslocamento do seu dia.
                        </>
                      ) : (
                        <>
                          It's ~<strong>{dist}km</strong> from the rest of{" "}
                          <strong>Day {dp.day_number}</strong>. Going there will
                          eat into your day.
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex flex-col sm:flex-row gap-2">
                  <button
                    onClick={() => handleKeep({ item, dp, alertText })}
                    disabled={isBusy}
                    className="flex-1 px-4 py-2.5 rounded-full bg-white border border-slate-300 text-slate-800 font-semibold text-sm hover:bg-slate-50 disabled:opacity-50 transition-colors"
                  >
                    {pt ? "Manter mesmo assim" : "Keep it anyway"}
                  </button>
                  <button
                    onClick={() => handleRemove({ item, dp })}
                    disabled={isBusy}
                    className="flex-1 px-4 py-2.5 rounded-full bg-red-600 hover:bg-red-700 text-white font-semibold text-sm disabled:opacity-50 transition-colors"
                  >
                    {pt ? "Remover do roteiro" : "Remove from trip"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 text-center">
          <button
            onClick={onClose}
            className="text-sm text-slate-500 hover:text-slate-800 font-medium"
          >
            {pt ? "Decidir depois" : "Decide later"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Export helper so other components can detect flagged items
export { isGeoAlert, collectFlaggedItems };
