import { useEffect, useState, useMemo, useRef } from "react";
import { useLanguage } from "../../i18n/LanguageContext";
import { fetchBuildStatus } from "../../api/buildStatus";

/**
 * Full-screen progress modal for the itinerary generation pipeline.
 *
 * Percentage model (rewritten — was time-based, now STAGE-based):
 *   - We poll /api/build-status every 3s and map the backend `stage` string
 *     to a percentage. This way a 90-second Sonnet call shows the correct
 *     "generating — 75%" label instead of creeping up to 95% by elapsed
 *     time alone. The bar reflects ACTUAL pipeline progress.
 *   - When extracting, we refine the percentage further using the
 *     extracted link count (e.g. link 2/3 done → higher % than 1/3).
 *   - If the backend doesn't return a stage (poll failed), we fall back
 *     to the phase prop and a conservative time-based estimate.
 *
 * Stuck detection (rewritten — was 90s wall clock, now stage-change):
 *   - "Stuck" means the backend's `stage` field has not changed for 60
 *     seconds. A build that's in the middle of a legitimate 80-second
 *     Sonnet call is NOT stuck — it's just working. We only show the
 *     escape-hatch card when the same stage string has been reported for
 *     60+ seconds in a row. This removes the false "stuck" alarm that
 *     was freaking users out on normal slow builds.
 */

// Stage → percentage mapping. Covers every stage string emitted by the
// orchestrator's `_mark()` calls in extract_profile_and_build + build_trip_itinerary.
// Keys are tested as SUBSTRINGS, first match wins (order matters).
const STAGE_TO_PCT = [
  ["fetching trip", 3],
  ["need to extract", 5],
  ["extracted link", 15], // refined per-link below
  ["analyzing profile", 30],
  ["profile auto-confirmed", 38],
  ["external research", 42],
  ["destination classified", 46],
  ["building itinerary", 50],
  ["start — fetching", 50],
  ["aggregating content", 52],
  ["content ready", 55],
  ["classifying sources", 60],
  ["generating itinerary", 65],
  // Inside build_trip_itinerary, "generating" covers the Sonnet call +
  // Google Places validation. We let time refine it from 65 → 92.
  ["validate", 88],
  ["creating items", 92],
  ["marking links", 95],
  ["DONE", 99],
];

function stageToPercent(stage, extractedCount, totalLinks, stageElapsed) {
  if (!stage) return null;
  const low = stage.toLowerCase();
  for (const [keyword, basePct] of STAGE_TO_PCT) {
    if (low.includes(keyword)) {
      // Special refinements:
      if (keyword === "extracted link" && totalLinks > 0) {
        // 5 → 28% distributed over the link count
        const ratio = Math.min(extractedCount / totalLinks, 1);
        return Math.round(5 + ratio * 23);
      }
      if (keyword === "generating itinerary") {
        // 65 → 88% over the first 60s of this stage. We stop interpolating
        // at 60s on purpose: that's when the stuck-detection threshold
        // fires. If we kept crawling past 60s the user would see a moving
        // bar AND a "stuck" card at the same time — contradictory UX. The
        // bar visibly freezes in sync with the stuck card instead.
        const clamped = Math.min(stageElapsed, 60_000);
        const t = clamped / 60_000;
        return Math.round(65 + t * 23);
      }
      return basePct;
    }
  }
  return null;
}

// Human-readable label for the current stage — shown under the percentage.
function stageToLabel(stage, pt) {
  if (!stage) return null;
  const low = stage.toLowerCase();
  if (low.includes("fetching") || low.includes("aggregating")) {
    return pt ? "Carregando dados da viagem..." : "Loading trip data...";
  }
  if (low.includes("extracted link") || low.includes("need to extract")) {
    return pt ? "Lendo vídeos (áudio + imagem)..." : "Reading videos (audio + image)...";
  }
  if (low.includes("analyzing profile") || low.includes("auto-confirmed")) {
    return pt ? "Identificando seu perfil de viagem..." : "Identifying your travel profile...";
  }
  if (low.includes("destination classified") || low.includes("external research")) {
    return pt ? "Classificando o destino..." : "Classifying the destination...";
  }
  if (low.includes("classifying sources")) {
    return pt ? "Lendo a estrutura dos vídeos..." : "Reading video structure...";
  }
  if (low.includes("generating itinerary") || low.includes("building itinerary")) {
    return pt ? "Gerando seu roteiro com IA..." : "Generating your itinerary with AI...";
  }
  if (low.includes("validate") || low.includes("creating items")) {
    return pt ? "Validando lugares no Google Maps..." : "Validating places on Google Maps...";
  }
  if (low.includes("marking links") || low.includes("done")) {
    return pt ? "Finalizando..." : "Finalizing...";
  }
  return null;
}

export default function GenerationProgressModal({ phase, trip, onRetry }) {
  const { lang } = useLanguage();
  const pt = lang === "pt-BR";

  const [now, setNow] = useState(Date.now());
  const [startedAt, setStartedAt] = useState(null);
  // Real backend state
  const [backendStage, setBackendStage] = useState(null);
  const [backendElapsed, setBackendElapsed] = useState(0);
  // Track when the current stage first appeared — this is what drives the
  // "stuck" detection (60s on the same stage = real stuck, not just slow).
  const stageChangedAtRef = useRef(Date.now());
  const lastStageRef = useRef(null);

  // Pick a start time the first time we enter a generating-like phase.
  useEffect(() => {
    if (!startedAt && phase) setStartedAt(Date.now());
    if (!phase) {
      setStartedAt(null);
      setBackendStage(null);
      stageChangedAtRef.current = Date.now();
      lastStageRef.current = null;
    }
  }, [phase, startedAt]);

  // Tick every 500ms so the bar visibly moves.
  useEffect(() => {
    if (!phase) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [phase]);

  // Poll /api/build-status every 3s for the real backend stage.
  useEffect(() => {
    if (!phase || !trip?.id) return;
    let alive = true;
    const poll = async () => {
      const status = await fetchBuildStatus(trip.id);
      if (!alive) return;
      if (status.active && status.stage) {
        setBackendStage(status.stage);
        setBackendElapsed((status.elapsed || 0) * 1000);
        // Detect stage change — reset the stuck timer
        if (lastStageRef.current !== status.stage) {
          lastStageRef.current = status.stage;
          stageChangedAtRef.current = Date.now();
        }
      }
    };
    poll(); // immediate
    const id = setInterval(poll, 3000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [phase, trip?.id]);

  const elapsedMs = startedAt ? now - startedAt : 0;

  const links = trip?.links || [];
  const extractedCount = links.filter(
    (l) => l.status === "extracted" || l.status === "processed"
  ).length;
  const totalLinks = links.length;

  // NEW percent calculation — prefer real backend stage, fall back to phase-based.
  const percent = useMemo(() => {
    if (!phase) return 0;
    const stageElapsed = backendStage ? now - stageChangedAtRef.current : 0;
    const fromStage = stageToPercent(
      backendStage, extractedCount, totalLinks, stageElapsed,
    );
    if (fromStage !== null) return fromStage;
    // Fallback to the old phase-based estimate when we don't have stage yet.
    if (phase === "extracting") {
      const ratio = totalLinks > 0 ? extractedCount / totalLinks : 0;
      return Math.round(ratio * 25);
    }
    if (phase === "analyzing") {
      const t = Math.min(elapsedMs / 15_000, 1);
      return Math.round(25 + t * 15);
    }
    if (phase === "generating") {
      const t = Math.min(elapsedMs / 75_000, 1);
      const eased = 1 - Math.pow(1 - t, 2);
      return Math.min(90, Math.round(40 + eased * 50));
    }
    return 0;
  }, [phase, backendStage, now, extractedCount, totalLinks, elapsedMs]);

  // NEW stuck detection — backend stage hasn't changed for 60s.
  // Fallback: if we have no backend stage at all after 120s, consider stuck.
  const stageAge = Date.now() - stageChangedAtRef.current;
  const stuck = useMemo(() => {
    if (backendStage && stageAge > 60_000) return true;
    if (!backendStage && elapsedMs > 120_000) return true; // no status in 2min = something's off
    return false;
  }, [backendStage, stageAge, elapsedMs]);

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

  const stageLabel = stageToLabel(backendStage, pt);

  if (!phase) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label={pt ? "Gerando roteiro" : "Generating itinerary"}
    >
      <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full p-8 space-y-6">
        {/* Header + big number + stage label */}
        <div className="text-center">
          <div className="text-4xl mb-1">
            {steps.find((s) => s.state === "active")?.icon || "✨"}
          </div>
          <div className="text-5xl font-bold text-gray-900 tabular-nums tracking-tight">
            {percent}%
          </div>
          <p className="text-sm text-gray-600 mt-2 font-medium min-h-[20px]">
            {stageLabel || (pt ? "Iniciando..." : "Starting...")}
          </p>
          {startedAt && (
            <p className="text-[11px] text-gray-400 mt-1 tabular-nums">
              ⏱ {Math.floor(elapsedMs / 1000)}s
              {" "}
              {pt
                ? "(continua rodando mesmo se você trocar de aba)"
                : "(keeps running even if you switch tabs)"}
            </p>
          )}
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

        {/* Helper text + stuck escape hatch. The hatch now fires only when
             the backend stage hasn't changed for 60s — not just when wall
             time passed 90s. A slow-but-working build no longer cries wolf. */}
        {!stuck && (
          <p className="text-[11px] text-gray-400 text-center">
            {pt
              ? "Pode demorar até 3 minutos em vídeos longos. Não feche a página."
              : "May take up to 3 minutes on long videos. Keep this page open."}
          </p>
        )}
        {stuck && (
          <div className="rounded-xl bg-amber-50 border-2 border-amber-300 p-3 space-y-2">
            <p className="text-sm text-amber-900 font-bold flex items-center gap-2">
              <span>⚠️</span>
              {pt ? "Parece travado" : "Looks stuck"}
            </p>
            <p className="text-[11px] text-amber-800/90 leading-relaxed">
              {pt
                ? `A geração está na mesma etapa há ${Math.floor(stageAge / 1000)}s. Se quiser, clica abaixo pra forçar reiniciar — nada que já foi extraído é perdido.`
                : `Generation has been on the same step for ${Math.floor(stageAge / 1000)}s. You can force a restart below — nothing already extracted is lost.`}
            </p>
            <button
              onClick={() => {
                if (onRetry) onRetry();
                else window.location.reload();
              }}
              className="w-full px-4 py-2.5 rounded-lg bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white text-sm font-bold transition shadow-md"
            >
              🔁 {pt ? "Forçar reiniciar geração" : "Force restart build"}
            </button>
            <p className="text-[10px] text-amber-700/70 text-center">
              {pt ? "(ou recarregue a página)" : "(or reload the page)"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
