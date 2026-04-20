import { useState } from "react";
import { useLanguage } from "../../i18n/LanguageContext";
import { analyzeUrls, analyzeUrlsDeep } from "../../api/analyze";

function extractUrls(text) {
  const matches = text.match(/https?:\/\/[^\s,;)<>]+/g) || [];
  return [...new Set(matches.map((u) => u.replace(/[.)]+$/, "")))];
}

export default function LinkAnalyzer({ onResult }) {
  const { t, lang } = useLanguage();
  const pt = lang === "pt-BR";
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);

  const detectedUrls = text.trim() ? extractUrls(text) : [];

  const humanStage = (stage, elapsed) => {
    if (!stage) return null;
    if (stage === "extracting" || stage === "transcribing_and_reading_frames") {
      if (elapsed < 8) {
        return pt
          ? "Lendo legenda e descrição dos vídeos..."
          : "Reading video captions...";
      }
      if (elapsed < 30) {
        return pt
          ? "Transcrevendo áudio dos vídeos..."
          : "Transcribing video audio...";
      }
      if (elapsed < 60) {
        return pt
          ? "Lendo texto sobreposto nos frames..."
          : "Reading on-screen text from frames...";
      }
      return pt
        ? "Cruzando tudo pra identificar lugares..."
        : "Cross-referencing to identify places...";
    }
    if (stage === "done") return pt ? "Pronto!" : "Done!";
    return null;
  };

  const handleAnalyze = async () => {
    if (detectedUrls.length === 0) return;
    setLoading(true);
    setError(null);
    setProgress(null);

    try {
      // Kick off deep analysis (polling) and fast preview in parallel
      const deepPromise = analyzeUrlsDeep(detectedUrls, (stage, elapsed) => {
        setProgress({ stage, elapsed, message: humanStage(stage, elapsed) });
      });

      // Fast preview so user sees something immediately if they wait
      let fastResult = null;
      try {
        fastResult = await analyzeUrls(detectedUrls);
      } catch {
        // preview failing is fine, we still wait for deep
      }

      // Now wait for deep to finish (it reads audio + vision)
      let deepResult = null;
      try {
        deepResult = await deepPromise;
      } catch (e) {
        // Deep failed — fall back to fast preview
        if (!fastResult) throw e;
      }

      const finalResult = deepResult || fastResult;
      if (!finalResult) throw new Error("No result");
      if (finalResult.error) {
        setError(finalResult.error);
      } else {
        onResult({ ...finalResult, urls: detectedUrls });
        setText("");
      }
    } catch (err) {
      setError(t("linkAnalyzer.error") || err.message);
    } finally {
      setLoading(false);
      setProgress(null);
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="bg-gray-900 rounded-2xl p-6 shadow-2xl">
        <div className="relative">
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0 text-2xl">🔗</div>
            <input
              type="text"
              value={text}
              onChange={(e) => { setText(e.target.value); setError(null); }}
              onKeyDown={(e) => e.key === "Enter" && handleAnalyze()}
              placeholder={t("linkAnalyzer.placeholder")}
              className="flex-1 bg-transparent text-white text-base placeholder-gray-400 outline-none font-medium"
              disabled={loading}
            />
            {detectedUrls.length > 0 && !loading && (
              <span className="text-xs text-coral-400 font-semibold flex-shrink-0">
                {detectedUrls.length} link{detectedUrls.length > 1 ? "s" : ""}
              </span>
            )}
          </div>
          <div className="mt-4 flex items-center gap-3 flex-wrap">
            <button
              onClick={handleAnalyze}
              disabled={loading || detectedUrls.length === 0}
              className="bg-coral-500 hover:bg-coral-600 disabled:opacity-40 text-white font-semibold px-6 py-2.5 rounded-xl text-sm transition-all flex items-center gap-2"
            >
              {loading ? (
                <>
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeDasharray="30 70" />
                  </svg>
                  {t("linkAnalyzer.analyzing")}
                </>
              ) : (
                t("linkAnalyzer.analyze")
              )}
            </button>
            {loading && progress?.message && (
              <span className="text-xs text-gray-300 animate-pulse">
                {progress.message}
              </span>
            )}
            {error && <p className="text-red-400 text-xs">{error}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
