import { useState } from "react";
import { useLanguage } from "../../i18n/LanguageContext";

/**
 * Manual-mode CTA that lets the user opt into AI organization at the
 * exact moment the workflow needs it: AFTER they've pasted videos and
 * (optionally) dragged some places into specific days, BEFORE they
 * spend more time arranging the rest by hand.
 *
 * Sits between the link input and the days list — central, hard to
 * miss, but unobtrusive (collapsed by default). Clicking the card
 * expands a short explanation of what the AI will do; clicking the
 * button fires onAssist (which kicks off the build).
 *
 * Hidden when:
 *   - trip already has items (the AI has already run; re-running
 *     would duplicate the itinerary).
 *   - no places have been extracted yet (nothing for the AI to chew on;
 *     the button would just spin).
 *
 * Behavior contract for the BACKEND build (orchestrator side, not this
 * component's responsibility but worth pinning here):
 *
 *   - Days the user has already populated MUST be respected. Items the
 *     user dropped into Day 2 stay on Day 2; the AI fills the rest of
 *     that day with related video items (same source) before touching
 *     other days.
 *   - Empty days get the leftover pool, clustered by proximity.
 *   - The AI must NEVER move or delete a user-placed item. If it tries
 *     to add a duplicate, the dedup pass on commit will reject it.
 */
export default function AiAssistBanner({
  running = false,
  onAssist,
  // Optional summary stats so the explanation feels grounded in
  // the user's actual data instead of generic copy.
  totalPlaces = 0,
  placedCount = 0,
  emptyDayCount = 0,
}) {
  const { lang } = useLanguage();
  const pt = lang === "pt-BR";
  const [expanded, setExpanded] = useState(false);

  const remaining = Math.max(totalPlaces - placedCount, 0);

  return (
    <div className="mb-4 rounded-2xl border-2 border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 overflow-hidden">
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="text-3xl flex-shrink-0 leading-none mt-0.5">🪄</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-bold text-gray-900">
                {pt
                  ? "Quer que a IA monte os dias pra você?"
                  : "Want the AI to organize the days for you?"}
              </h3>
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="text-[11px] font-medium text-amber-700 hover:text-amber-900 underline-offset-2 hover:underline"
                aria-expanded={expanded}
              >
                {pt
                  ? (expanded ? "menos detalhes" : "como funciona?")
                  : (expanded ? "less detail" : "how does it work?")}
              </button>
            </div>
            <p className="text-xs text-gray-600 mt-1 leading-relaxed">
              {pt
                ? `Você arrasta os lugares que quiser nos dias certos. Quando clicar aqui, a IA respeita o que você já colocou e completa o resto.`
                : `Drag the places you want onto the right days. When you click here, the AI keeps what you placed and fills in the rest.`}
            </p>
          </div>
          <button
            type="button"
            onClick={onAssist}
            disabled={running || totalPlaces === 0}
            className="flex-shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold shadow-sm transition-colors"
          >
            {running ? (
              <>
                <span className="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                {pt ? "Organizando..." : "Organizing..."}
              </>
            ) : (
              <>
                <span>✨</span>
                {pt ? "Assistência IA" : "AI Assist"}
              </>
            )}
          </button>
        </div>

        {expanded && (
          <div className="mt-4 pt-4 border-t border-amber-200/60 space-y-2.5">
            <ExplainRow icon="📌">
              {pt ? (
                <>
                  <strong>Dias com lugares seus</strong>: a IA pega o vídeo de
                  origem desses lugares e completa o dia com o resto do
                  itinerário daquele criador. Nada do que você colocou é
                  movido ou deletado.
                </>
              ) : (
                <>
                  <strong>Days you populated</strong>: the AI picks up the
                  source video for those places and fills the day with the
                  rest of that creator's itinerary. Nothing you placed gets
                  moved or deleted.
                </>
              )}
            </ExplainRow>
            <ExplainRow icon="🗓️">
              {pt ? (
                <>
                  <strong>Dias vazios</strong>: preenche com lugares restantes
                  do pool, agrupando por proximidade pra você não ziguezaguear
                  pela cidade.
                </>
              ) : (
                <>
                  <strong>Empty days</strong>: fills with leftover places from
                  the pool, grouped by proximity so you don't zigzag across
                  the city.
                </>
              )}
            </ExplainRow>
            <ExplainRow icon="🛡️">
              {pt ? (
                <>
                  <strong>À prova de bagunça</strong>: itens duplicados são
                  rejeitados, dias com mais de 12km de spread são divididos,
                  horários nunca colidem.
                </>
              ) : (
                <>
                  <strong>Mess-proof</strong>: duplicates are rejected, days
                  with &gt;12km spread are split, time slots never collide.
                </>
              )}
            </ExplainRow>
            {totalPlaces > 0 && (
              <div className="mt-3 pt-3 border-t border-amber-200/40 text-[11px] text-gray-500 flex items-center gap-3 flex-wrap">
                <span>
                  📍 <strong className="text-gray-700">{totalPlaces}</strong>{" "}
                  {pt ? "lugares extraídos" : "places extracted"}
                </span>
                <span>·</span>
                <span>
                  ✋ <strong className="text-gray-700">{placedCount}</strong>{" "}
                  {pt ? "já posicionados por você" : "placed by you"}
                </span>
                <span>·</span>
                <span>
                  🪣 <strong className="text-gray-700">{remaining}</strong>{" "}
                  {pt ? "no pool" : "in pool"}
                </span>
                {emptyDayCount > 0 && (
                  <>
                    <span>·</span>
                    <span>
                      🗓️ <strong className="text-gray-700">{emptyDayCount}</strong>{" "}
                      {pt ? "dias vazios" : "empty days"}
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ExplainRow({ icon, children }) {
  return (
    <div className="flex items-start gap-2 text-xs text-gray-700 leading-relaxed">
      <span className="text-base leading-none flex-shrink-0">{icon}</span>
      <p className="flex-1">{children}</p>
    </div>
  );
}
