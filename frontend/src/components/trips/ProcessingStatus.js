/**
 * Shows real-time processing status feedback during the AI pipeline.
 * Phases: extracting links → analyzing profile → generating itinerary
 */
import { useLanguage } from "../../i18n/LanguageContext";

export default function ProcessingStatus({ trip }) {
  const { t } = useLanguage();

  if (!trip?.links || trip.links.length === 0) return null;

  const links = trip.links;
  const totalLinks = links.length;
  const extractedCount = links.filter((l) => l.status === "extracted" || l.status === "processed").length;
  const processingCount = links.filter((l) => l.status === "processing").length;
  const pendingCount = links.filter((l) => l.status === "pending").length;

  const allExtracted = extractedCount === totalLinks && totalLinks > 0;
  const hasActiveLinks = processingCount > 0 || pendingCount > 0;
  const profileStatus = trip.profile_status;
  const hasItems = trip.items_count > 0 || trip.day_plans?.some((dp) => dp.itinerary_items?.length > 0);

  // Determine current phase
  let phase = null;
  let message = "";
  let detail = "";
  let progress = 0;

  if (hasActiveLinks) {
    phase = "extracting";
    message = t("processing.extracting");
    detail = `${extractedCount}/${totalLinks} ${t("processing.linksExtracted")}`;
    progress = (extractedCount / totalLinks) * 100;
  } else if (allExtracted && profileStatus !== "suggested" && profileStatus !== "confirmed" && profileStatus !== "rejected") {
    phase = "analyzing";
    message = t("processing.analyzing");
    detail = t("processing.analyzingDesc");
    progress = 100;
  } else if (profileStatus === "confirmed" && !hasItems) {
    phase = "generating";
    message = t("processing.generating");
    detail = t("processing.generatingDesc");
    progress = 100;
  }

  if (!phase) return null;

  const phaseColors = {
    extracting: "from-coral-500/20 to-coral-600/10 border-coral-500/30",
    analyzing: "from-violet-500/20 to-violet-600/10 border-violet-500/30",
    generating: "from-emerald-500/20 to-emerald-600/10 border-emerald-500/30",
  };

  const dotColors = {
    extracting: "bg-coral-400",
    analyzing: "bg-violet-400",
    generating: "bg-emerald-400",
  };

  const icons = {
    extracting: "🔗",
    analyzing: "✨",
    generating: "🗺️",
  };

  return (
    <div className={`mb-4 rounded-xl border bg-gradient-to-r ${phaseColors[phase]} p-4`}>
      <div className="flex items-center gap-3">
        <span className="text-lg">{icons[phase]}</span>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className={`inline-block w-2 h-2 rounded-full ${dotColors[phase]} animate-pulse`} />
            <span className="text-sm font-medium text-gray-800">{message}</span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">{detail}</p>
        </div>
      </div>

      {phase === "extracting" && (
        <div className="mt-3 h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-coral-500 rounded-full transition-all duration-500"
            style={{ width: `${Math.max(progress, 10)}%` }}
          />
        </div>
      )}

      {(phase === "analyzing" || phase === "generating") && (
        <div className="mt-3 h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full animate-pulse ${
              phase === "analyzing" ? "bg-violet-500" : "bg-emerald-500"
            }`}
            style={{ width: "100%", opacity: 0.6 }}
          />
        </div>
      )}
    </div>
  );
}
