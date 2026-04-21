/**
 * Shows real-time processing status feedback during the AI pipeline.
 * Phases: extracting links → analyzing profile → generating itinerary
 *
 * Phase 5.5 — the heavy phases (analyzing + generating) are now shown as a
 * full-screen modal via `GenerationProgressModal`. This inline component
 * stays visible for the quick extraction phase only, so the page doesn't
 * look empty while the user is still pasting links.
 */
import { useLanguage } from "../../i18n/LanguageContext";

/**
 * Pure phase-detection helper — exported so the modal and the inline card
 * share exactly one definition of "what is the pipeline doing right now?"
 */
export function detectPhase(trip) {
  if (!trip?.links || trip.links.length === 0) {
    return { phase: null, totalLinks: 0, extractedCount: 0 };
  }
  const links = trip.links;
  const totalLinks = links.length;
  const extractedCount = links.filter(
    (l) => l.status === "extracted" || l.status === "processed"
  ).length;
  const processingCount = links.filter((l) => l.status === "processing").length;
  const pendingCount = links.filter((l) => l.status === "pending").length;
  const allExtracted = extractedCount === totalLinks && totalLinks > 0;
  const hasActiveLinks = processingCount > 0 || pendingCount > 0;
  const profileStatus = trip.profile_status;
  const hasItems =
    trip.items_count > 0 ||
    trip.day_plans?.some((dp) => dp.itinerary_items?.length > 0);

  let phase = null;
  if (hasActiveLinks) phase = "extracting";
  else if (
    allExtracted &&
    profileStatus !== "suggested" &&
    profileStatus !== "confirmed" &&
    profileStatus !== "rejected"
  )
    phase = "analyzing";
  else if (profileStatus === "confirmed" && !hasItems) phase = "generating";

  return { phase, totalLinks, extractedCount };
}

export default function ProcessingStatus({ trip }) {
  const { t } = useLanguage();
  const { phase, totalLinks, extractedCount } = detectPhase(trip);

  // The heavy phases now render as a modal elsewhere — keep the inline
  // card ONLY for "extracting" so it doesn't duplicate the modal.
  if (phase !== "extracting") return null;

  const message = t("processing.extracting");
  const detail = `${extractedCount}/${totalLinks} ${t("processing.linksExtracted")}`;
  const progress = (extractedCount / totalLinks) * 100;

  return (
    <div className="mb-4 rounded-xl border bg-gradient-to-r from-coral-500/20 to-coral-600/10 border-coral-500/30 p-4">
      <div className="flex items-center gap-3">
        <span className="text-lg">🔗</span>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-coral-400 animate-pulse" />
            <span className="text-sm font-medium text-gray-800">{message}</span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">{detail}</p>
        </div>
      </div>
      <div className="mt-3 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-coral-500 rounded-full transition-all duration-500"
          style={{ width: `${Math.max(progress, 10)}%` }}
        />
      </div>
    </div>
  );
}
