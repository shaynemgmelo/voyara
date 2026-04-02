import { useState, useEffect, useRef } from "react";
import { useLanguage } from "../../i18n/LanguageContext";

/*
 * AI Feedback box with rich progress tracking.
 * When refining, transforms into a visual progress panel showing
 * each step of the AI process so the user feels accompanied.
 */

const PROGRESS_STEPS = {
  en: [
    { icon: "💬", label: "Reading your request...", duration: 2000 },
    { icon: "🧠", label: "Analyzing current itinerary...", duration: 3000 },
    { icon: "🔍", label: "Searching for better places...", duration: 5000 },
    { icon: "📍", label: "Validating locations on Google Maps...", duration: 4000 },
    { icon: "🗺️", label: "Optimizing routes and times...", duration: 4000 },
    { icon: "✨", label: "Applying changes to your itinerary...", duration: 6000 },
  ],
  "pt-BR": [
    { icon: "💬", label: "Lendo seu pedido...", duration: 2000 },
    { icon: "🧠", label: "Analisando roteiro atual...", duration: 3000 },
    { icon: "🔍", label: "Buscando lugares melhores...", duration: 5000 },
    { icon: "📍", label: "Validando locais no Google Maps...", duration: 4000 },
    { icon: "🗺️", label: "Otimizando rotas e horários...", duration: 4000 },
    { icon: "✨", label: "Aplicando mudanças no roteiro...", duration: 6000 },
  ],
};

export default function FeedbackBox({ onSubmit, loading, placeholder, compact = false, alwaysOpen = false }) {
  const { t, lang } = useLanguage();
  const [feedback, setFeedback] = useState("");
  const [expanded, setExpanded] = useState(alwaysOpen);

  // Progress tracking
  const [submittedText, setSubmittedText] = useState("");
  const [progressStep, setProgressStep] = useState(0);
  const [showDone, setShowDone] = useState(false);
  const wasLoading = useRef(false);
  const progressTimer = useRef(null);

  const handleSubmit = () => {
    if (!feedback.trim() || loading) return;
    setSubmittedText(feedback.trim());
    setProgressStep(0);
    setShowDone(false);
    onSubmit(feedback.trim());
    setFeedback("");
    if (!alwaysOpen) setExpanded(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Progress step advancement
  useEffect(() => {
    if (loading && submittedText) {
      const steps = PROGRESS_STEPS[lang] || PROGRESS_STEPS.en;
      let stepIdx = 0;
      setProgressStep(0);

      const advanceStep = () => {
        stepIdx++;
        if (stepIdx < steps.length) {
          setProgressStep(stepIdx);
          progressTimer.current = setTimeout(advanceStep, steps[stepIdx].duration);
        }
        // If we reach the end, stay on last step until loading finishes
      };

      progressTimer.current = setTimeout(advanceStep, steps[0].duration);

      return () => {
        if (progressTimer.current) clearTimeout(progressTimer.current);
      };
    }
  }, [loading, submittedText, lang]);

  // Detect loading → done transition
  useEffect(() => {
    if (wasLoading.current && !loading && submittedText) {
      setShowDone(true);
      const timer = setTimeout(() => {
        setShowDone(false);
        setSubmittedText("");
        setProgressStep(0);
      }, 3000);
      return () => clearTimeout(timer);
    }
    wasLoading.current = loading;
  }, [loading, submittedText]);

  // ══ PROGRESS VIEW — shown while AI is working ══
  if ((loading || showDone) && submittedText) {
    const steps = PROGRESS_STEPS[lang] || PROGRESS_STEPS.en;
    const pt = lang === "pt-BR";

    return (
      <div className="rounded-xl bg-gradient-to-br from-coral-50 via-orange-50 to-amber-50 border border-coral-200 overflow-hidden">
        {/* User's feedback */}
        <div className="px-3 pt-3 pb-2 flex items-start gap-2">
          <div className="w-6 h-6 rounded-full bg-coral-500 flex items-center justify-center flex-shrink-0 mt-0.5">
            <svg className="w-3 h-3 text-white" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-6-3a2 2 0 11-4 0 2 2 0 014 0zm-2 4a5 5 0 00-4.546 2.916A5.986 5.986 0 0010 16a5.986 5.986 0 004.546-2.084A5 5 0 0010 11z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-[9px] font-bold text-coral-500 uppercase tracking-wider">
              {pt ? "Seu pedido" : "Your request"}
            </span>
            <p className="text-xs text-gray-700 mt-0.5 leading-relaxed line-clamp-2">
              "{submittedText}"
            </p>
          </div>
        </div>

        {/* Progress steps */}
        <div className="px-3 pb-3">
          <div className="space-y-1">
            {steps.map((step, i) => {
              const isActive = !showDone && i === progressStep;
              const isDone = showDone || i < progressStep;
              const isFuture = !showDone && i > progressStep;

              return (
                <div
                  key={i}
                  className={`flex items-center gap-2 px-2 py-1 rounded-lg transition-all duration-300 ${
                    isActive
                      ? "bg-white/80 shadow-sm"
                      : isDone
                      ? "opacity-60"
                      : "opacity-0 h-0 py-0 overflow-hidden"
                  }`}
                  style={{
                    maxHeight: isFuture ? 0 : 40,
                    transition: "all 0.3s ease-out",
                  }}
                >
                  {/* Status indicator */}
                  <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
                    {isActive ? (
                      <div className="w-4 h-4 rounded-full border-2 border-coral-500 border-t-transparent animate-spin" />
                    ) : isDone ? (
                      <svg className="w-4 h-4 text-emerald-500" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    ) : (
                      <div className="w-2 h-2 rounded-full bg-gray-300" />
                    )}
                  </div>

                  {/* Step label */}
                  <div className="flex items-center gap-1.5 flex-1 min-w-0">
                    <span className="text-xs">{step.icon}</span>
                    <span className={`text-[11px] font-medium truncate ${
                      isActive ? "text-gray-800" : isDone ? "text-gray-500" : "text-gray-400"
                    }`}>
                      {step.label}
                    </span>
                  </div>

                  {/* Active shimmer */}
                  {isActive && (
                    <div className="flex gap-0.5">
                      <div className="w-1 h-1 rounded-full bg-coral-400 animate-pulse" />
                      <div className="w-1 h-1 rounded-full bg-coral-400 animate-pulse" style={{ animationDelay: "0.2s" }} />
                      <div className="w-1 h-1 rounded-full bg-coral-400 animate-pulse" style={{ animationDelay: "0.4s" }} />
                    </div>
                  )}
                </div>
              );
            })}

            {/* Done state */}
            {showDone && (
              <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 animate-fadeInUp">
                <span className="text-sm">🎉</span>
                <span className="text-[11px] font-bold text-emerald-700">
                  {pt ? "Pronto! Roteiro atualizado" : "Done! Itinerary updated"}
                </span>
              </div>
            )}
          </div>

          {/* Overall progress bar */}
          {!showDone && (
            <div className="mt-2 h-1 bg-white/60 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-coral-400 to-coral-500 rounded-full transition-all duration-1000 ease-linear"
                style={{ width: `${Math.min(95, ((progressStep + 1) / steps.length) * 100)}%` }}
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  // ══ COLLAPSED BUTTON MODE ══
  if (!expanded && !alwaysOpen) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className={`flex items-center gap-1.5 text-gray-400 hover:text-coral-500 transition-colors ${
          compact ? "text-[10px]" : "text-xs"
        }`}
        title={t("feedback.title")}
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className={compact ? "w-3 h-3" : "w-3.5 h-3.5"}>
          <path d="M1 8.849c0 1.204.618 2.272 1.58 2.88a3.097 3.097 0 0 0-.34 1.334c0 .216.022.428.066.633A.75.75 0 0 0 3.347 14a4.593 4.593 0 0 1-1.453-.921c-.37.228-.81.35-1.27.35A2.626 2.626 0 0 1 0 10.849V8.849C0 7.512.762 6.325 1.957 5.772a.75.75 0 1 1 .646 1.354A1.628 1.628 0 0 0 1 8.849ZM10.5 3A2.5 2.5 0 0 0 8 5.5v3A2.5 2.5 0 0 0 10.5 11h.5v1.862a.75.75 0 0 0 1.238.57L14.97 11H15.5a2.5 2.5 0 0 0 2.5-2.5v-3A2.5 2.5 0 0 0 15.5 3h-5Z" />
        </svg>
        {!compact && t("feedback.refine")}
      </button>
    );
  }

  // ══ INLINE INPUT MODE — always visible ══
  if (alwaysOpen) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex-1 relative">
          <input
            type="text"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder || t("feedback.placeholder")}
            className="w-full text-xs bg-coral-50/50 border border-coral-200 rounded-lg pl-3 pr-9 py-2 focus:outline-none focus:ring-1 focus:ring-coral-400 focus:border-coral-400 focus:bg-white transition-colors placeholder:text-coral-300"
            disabled={loading}
          />
          <button
            onClick={handleSubmit}
            disabled={!feedback.trim() || loading}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-coral-300 hover:text-coral-500 disabled:text-coral-200 transition-colors"
            title={t("feedback.send")}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path d="M3.105 2.288a.75.75 0 0 0-.826.95l1.414 4.926A1.5 1.5 0 0 0 5.135 9.25h6.115a.75.75 0 0 1 0 1.5H5.135a1.5 1.5 0 0 0-1.442 1.086l-1.414 4.926a.75.75 0 0 0 .826.95 28.897 28.897 0 0 0 15.293-7.155.75.75 0 0 0 0-1.114A28.897 28.897 0 0 0 3.105 2.288Z" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  // ══ EXPANDED PANEL MODE ══
  return (
    <div className={`${compact ? "mt-1" : "mt-2"}`}>
      <div className="bg-coral-50 border border-coral-200 rounded-lg p-3">
        <div className="flex items-start gap-2">
          <textarea
            autoFocus
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder || t("feedback.placeholder")}
            rows={2}
            className="flex-1 text-sm bg-white border border-gray-200 rounded-md px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-coral-400 focus:border-coral-400"
            disabled={loading}
          />
        </div>
        <div className="flex items-center justify-between mt-2">
          <span className="text-[10px] text-gray-400">
            {t("feedback.hint")}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => { setExpanded(false); setFeedback(""); }}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
              disabled={loading}
            >
              {t("feedback.cancel")}
            </button>
            <button
              onClick={handleSubmit}
              disabled={!feedback.trim() || loading}
              className="px-3 py-1 bg-coral-500 hover:bg-coral-400 disabled:bg-gray-300 text-white text-xs font-medium rounded-md transition-colors flex items-center gap-1.5"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
                <path d="M8 1a.75.75 0 0 1 .75.75v6.5a.75.75 0 0 1-1.5 0v-6.5A.75.75 0 0 1 8 1ZM4.11 3.05a.75.75 0 0 1 0 1.06L2.172 6.05a.75.75 0 0 1-1.06-1.06l1.938-1.94a.75.75 0 0 1 1.06 0Zm7.78 0a.75.75 0 0 1 1.06 0l1.938 1.94a.75.75 0 1 1-1.06 1.06L11.89 4.11a.75.75 0 0 1 0-1.06ZM8 14a.75.75 0 0 1-.75-.75v-1.5a.75.75 0 0 1 1.5 0v1.5A.75.75 0 0 1 8 14Z" />
              </svg>
              {t("feedback.send")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
