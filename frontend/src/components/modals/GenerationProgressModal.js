import { useEffect, useState, useMemo } from "react";
import { useLanguage } from "../../i18n/LanguageContext";

/**
 * Full-screen progress modal for the itinerary generation pipeline.
 *
 * Why a modal (not inline): generation takes 30-120 seconds and during that
 * window the page has nothing useful to do. A centered modal gives the user
 * focused feedback + a clear percentage instead of a vague spinner.
 *
 * Percentage model:
 *   - We don't have true per-phase telemetry from the backend, so the bar
 *     is TIME-WEIGHTED with an asymptotic ease-out that never hits 100%
 *     until the backend signals `hasItems` (i.e. real completion).
 *   - Extraction sub-phase: 0→25% driven by extractedCount / totalLinks.
 *   - Classification: 25→40% (fixed bump when all links are extracted).
 *   - Generation: 40→95% eased by elapsed time with an estimated duration
 *     of 75 seconds. Past that it creeps very slowly to 95% to avoid
 *     the "stuck at 100% for 30s" feeling.
 *   - Done: 100% (snaps to full, then dismisses).
 *
 * Phase detection mirrors ProcessingStatus — this component is rendered by
 * the page only when we're in a generating/analyzing/extracting phase.
 */
export default function GenerationProgressModal({ phase, trip, onRetry }) {
  const { lang } = useLanguage();
  const pt = lang === "pt-BR";
  const [now, setNow] = useState(Date.now());
  const [startedAt, setStartedAt] = useState(null);

  // Pick a start time the first time we enter a generating-like phase, so
  // the bar only resets when the user retries — not when React re-renders.
  useEffect(() => {
    if (!startedAt && phase) setStartedAt(Date.now());
    if (!phase) setStartedAt(null);
  }, [phase, startedAt]);

  // Tick every 500ms so the bar visibly moves. Cheap re-render — no fetch.
  useEffect(() => {
    if (!phase) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [phase]);

  // Stuck detection — if we've been on the same phase for more than 2.5 minutes,
  // offer the user an escape hatch (reload page) instead of leaving them
  // staring at 95% forever. Timeouts on the backend (added same commit) now
  // cap each AI call, so hitting this window usually means a network wedge.
  const elapsedMs = startedAt ? now - startedAt : 0;
  const stuck = elapsedMs > 150_000; // 2.5 minutes

  const links = trip?.links || [];
  const extractedCount = links.filter(
    (l) => l.status === "extracted" || l.status === "processed"
  ).length;
  const totalLinks = links.length;

  const percent = useMemo(() => {
    if (!phase) return 0;
    const elapsed = startedAt ? now - startedAt : 0;

    if (phase === "extracting") {
      // 0 → 25% based on extracted/total
      const linkRatio = totalLinks > 0 ? extractedCount / totalLinks : 0;
      return Math.round(linkRatio * 25);
    }
    if (phase === "analyzing") {
      // 25 → 40%, eased over 15s
      const t = Math.min(elapsed / 15_000, 1);
      return Math.round(25 + t * 15);
    }
    if (phase === "generating") {
      // 40 → 95% with ease-out; 75s to reach ~90%, then asymptotic toward 95
      const estMs = 75_000;
      const t = elapsed / estMs;
      const eased = 1 - Math.pow(1 - Math.min(t, 1), 2); // quadratic ease-out
      const slowTail = t > 1 ? Math.min(0.05, (t - 1) * 0.02) : 0; // creep
      return Math.min(95, Math.round(40 + eased * 55 + slowTail * 100));
    }
    return 0;
  }, [phase, now, startedAt, extractedCount, totalLinks]);

  const steps = useMemo(() => {
    const defs = [
      {
        key: "extracting",
        icon: "🔗",
        label: pt ? "Extraindo links" : "Extracting links",
        sub: pt ? "Abrindo vídeos e lendo legendas" : "Opening videos + reading captions",
      },
      {
        key: "analyzing",
        icon: "🧠",
        label: pt ? "Analisando conteúdo" : "Analyzing content",
        sub: pt
          ? "Identificando lugares, dias e perfil de viagem"
          : "Identifying places, days, and travel profile",
      },
      {
        key: "generating",
        icon: "🗺️",
        label: pt ? "Gerando roteiro" : "Generating itinerary",
        sub: pt
          ? "Montando os dias, agrupando por região, validando no Google Maps"
          : "Building days, clustering by region, validating on Google Maps",
      },
    ];
    const order = ["extracting", "analyzing", "generating"];
    const currentIdx = order.indexOf(phase);
    return defs.map((d, i) => ({
      ...d,
      state:
        i < currentIdx ? "done" : i === currentIdx ? "active" : "pending",
    }));
  }, [phase, pt]);

  if (!phase) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label={pt ? "Gerando roteiro" : "Generating itinerary"}
    >
      <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full p-8 space-y-6">
        {/* Header + big number */}
        <div className="text-center">
          <div className="text-4xl mb-1">
            {steps.find((s) => s.state === "active")?.icon || "✨"}
          </div>
          <div className="text-5xl font-bold text-gray-900 tabular-nums tracking-tight">
            {percent}%
          </div>
          <p className="text-sm text-gray-500 mt-1">
            {pt
              ? "Estamos montando sua viagem..."
              : "We're building your trip..."}
          </p>
        </div>

        {/* Progress bar */}
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-coral-500 to-amber-400 rounded-full transition-all duration-700 ease-out"
            style={{ width: `${Math.max(percent, 3)}%` }}
          />
        </div>

        {/* Step list */}
        <div className="space-y-2">
          {steps.map((s) => (
            <div
              key={s.key}
              className={`flex items-center gap-3 rounded-xl px-3 py-2 transition ${
                s.state === "active"
                  ? "bg-coral-50"
                  : s.state === "done"
                  ? "opacity-60"
                  : "opacity-40"
              }`}
            >
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-sm flex-shrink-0 ${
                  s.state === "done"
                    ? "bg-emerald-100 text-emerald-700"
                    : s.state === "active"
                    ? "bg-coral-100 text-coral-700 animate-pulse"
                    : "bg-gray-100 text-gray-400"
                }`}
              >
                {s.state === "done" ? "✓" : s.icon}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">
                  {s.label}
                </p>
                <p className="text-[11px] text-gray-500 truncate">{s.sub}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Helper text + stuck escape hatch */}
        {!stuck && (
          <p className="text-[11px] text-gray-400 text-center">
            {pt
              ? "Pode demorar até 2 minutos em vídeos longos. Não feche a página."
              : "May take up to 2 minutes on long videos. Keep this page open."}
          </p>
        )}
        {stuck && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 space-y-2">
            <p className="text-xs text-amber-900 font-semibold">
              {pt ? "Está demorando mais que o normal" : "Taking longer than usual"}
            </p>
            <p className="text-[11px] text-amber-800/80">
              {pt
                ? "Às vezes um link específico é lento de abrir. Você pode recarregar a página — os lugares já extraídos ficam salvos."
                : "Sometimes a single link is slow to open. Reload the page — already-extracted places stay saved."}
            </p>
            <button
              onClick={() => {
                if (onRetry) onRetry();
                else window.location.reload();
              }}
              className="w-full px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold transition"
            >
              {pt ? "Recarregar página" : "Reload page"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
