import { useState } from "react";
import { useLanguage } from "../../i18n/LanguageContext";

/**
 * Surfaces the post-build validation report (`traveler_profile.validation_report`)
 * so the user sees a clear summary of anything the validator had to repair
 * or flag — instead of silently shipping an itinerary with thin days or
 * missing transfers.
 *
 * The backend's `_validate_and_repair_itinerary` (STEPs 6-9 of the travel-
 * planning spec) produces this shape:
 *
 *   {
 *     dropped_destination_as_activity: [{name, day}],
 *     thin_days: [{day, item_count, reason}],
 *     injected_transfers: [{day, from, to}],
 *     total_violations: N
 *   }
 *
 * We render a collapsible amber banner summarizing the counts, with an
 * "Ver detalhes" toggle to see the item list.
 */
export default function ValidationReportBanner({ report }) {
  const { lang } = useLanguage();
  const pt = lang === "pt-BR";
  const [expanded, setExpanded] = useState(false);

  if (!report || !report.total_violations) return null;

  const dropped = report.dropped_destination_as_activity || [];
  const thin = report.thin_days || [];
  const transfers = report.injected_transfers || [];

  const headline = pt
    ? `Revisamos seu roteiro: ${report.total_violations} ajuste(s) automático(s).`
    : `We reviewed your itinerary: ${report.total_violations} automatic adjustment(s).`;

  return (
    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-amber-100/50 transition"
      >
        <span className="text-lg">🛠️</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-amber-900">{headline}</div>
          <div className="text-[11px] text-amber-800/80 mt-0.5 truncate">
            {[
              dropped.length && (pt
                ? `${dropped.length} item(ns) vago(s) removido(s)`
                : `${dropped.length} vague item(s) removed`),
              thin.length && (pt
                ? `${thin.length} dia(s) ficaram curto(s)`
                : `${thin.length} day(s) came out short`),
              transfers.length && (pt
                ? `${transfers.length} transferência(s) adicionada(s)`
                : `${transfers.length} transfer(s) added`),
            ].filter(Boolean).join(" · ")}
          </div>
        </div>
        <span className="text-amber-600 text-xs">{expanded ? "▴" : "▾"}</span>
      </button>

      {expanded && (
        <div className="px-4 pb-3 border-t border-amber-100 text-[12px] space-y-2">
          {dropped.length > 0 && (
            <div>
              <div className="font-semibold text-amber-900 mt-2">
                {pt ? "Itens removidos (destino sem ação concreta)" : "Removed items (destination without concrete action)"}
              </div>
              <ul className="list-disc pl-5 text-amber-800">
                {dropped.map((d, i) => (
                  <li key={i}>
                    <span className="font-mono">{d.name}</span>
                    {d.day && <span className="text-amber-600"> · Dia {d.day}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {transfers.length > 0 && (
            <div>
              <div className="font-semibold text-amber-900 mt-2">
                {pt ? "Dias de transferência adicionados" : "Transfer days added"}
              </div>
              <ul className="list-disc pl-5 text-amber-800">
                {transfers.map((t, i) => (
                  <li key={i}>
                    Dia {t.day}: <span className="font-mono">{t.from} → {t.to}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {thin.length > 0 && (
            <div>
              <div className="font-semibold text-amber-900 mt-2">
                {pt ? "Dias que ficaram curtos" : "Days that came out short"}
              </div>
              <ul className="list-disc pl-5 text-amber-800">
                {thin.map((t, i) => (
                  <li key={i}>
                    Dia {t.day} — {t.item_count} item(ns) ·{" "}
                    <span className="text-amber-600 italic">
                      {t.reason === "empty"
                        ? (pt ? "vazio" : "empty")
                        : (pt ? "só itens curtos" : "short items only")}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-amber-700 mt-1 italic">
                {pt
                  ? "Use o chat do roteiro pra pedir mais atividades nesses dias."
                  : "Use the itinerary chat to ask for more activities on those days."}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
