import { useLanguage } from "../../i18n/LanguageContext";

export default function SchedulePreview({ proposals, onApply, onClose }) {
  const { t } = useLanguage();

  if (!proposals || proposals.length === 0) return null;

  const hasChanges = proposals.some(
    (p) => p.current_time_slot !== p.suggested_time_slot
  );

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-sm w-full max-w-md max-h-[80vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 p-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">{t("schedule.recalculate")}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-900">
            ✕
          </button>
        </div>

        <div className="p-4 space-y-3">
          {proposals.map((p, i) => {
            const changed = p.current_time_slot !== p.suggested_time_slot;
            return (
              <div key={p.item_id}>
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <p className="text-sm text-gray-900">{p.name}</p>
                    <div className="flex items-center gap-2 text-xs mt-0.5">
                      <span className={changed ? "text-gray-400 line-through" : "text-gray-500"}>
                        {p.current_time_slot || t("schedule.noTime")}
                      </span>
                      {changed && (
                        <>
                          <span className="text-gray-300">-&gt;</span>
                          <span className="text-emerald-400 font-medium">
                            {p.suggested_time_slot}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                {p.reason && (
                  <p className="text-[10px] text-gray-400 mt-0.5 ml-0">{p.reason}</p>
                )}
                {i < proposals.length - 1 && (
                  <div className="border-t border-dashed border-gray-200 mt-2" />
                )}
              </div>
            );
          })}
        </div>

        <div className="sticky bottom-0 bg-white border-t border-gray-200 p-4 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-lg text-sm text-gray-500 hover:text-gray-900 bg-gray-100 transition-colors"
          >
            {t("schedule.cancel")}
          </button>
          {hasChanges && (
            <button
              onClick={() => onApply(proposals)}
              className="flex-1 py-2 rounded-lg text-sm font-medium text-white bg-coral-500 hover:bg-coral-400 transition-colors"
            >
              {t("schedule.applyAll")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
