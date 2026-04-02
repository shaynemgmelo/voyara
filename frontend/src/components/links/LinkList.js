import { useState } from "react";
import { useLanguage } from "../../i18n/LanguageContext";

const PLATFORM_COLORS = {
  instagram: "bg-pink-600",
  youtube: "bg-red-600",
  tiktok: "bg-gray-200",
  blog: "bg-green-600",
  other: "bg-gray-400",
};

export default function LinkList({ links, onDelete }) {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(false);

  if (!links || links.length === 0) return null;

  const STATUS_LABELS = {
    pending: { text: t("linkList.queued"), color: "text-yellow-500", animate: false },
    processing: { text: t("linkList.extracting"), color: "text-coral-600", animate: true },
    extracted: { text: t("linkList.extracted"), color: "text-emerald-600", animate: false },
    processed: { text: t("linkList.done"), color: "text-green-600", animate: false },
    failed: { text: t("linkList.failed"), color: "text-red-500", animate: false },
  };

  const allProcessed = links.every((l) => l.status === "processed");
  const processingCount = links.filter((l) => l.status === "processing" || l.status === "pending").length;

  // Collapsed summary when all processed
  if (allProcessed && !expanded) {
    const totalPlaces = links.reduce(
      (sum, l) => sum + (l.extracted_data?.places_created || 0), 0
    );
    return (
      <button
        onClick={() => setExpanded(true)}
        className="mt-2 flex items-center gap-2 text-xs text-gray-400 hover:text-gray-600 transition-colors"
      >
        <span>{links.length} {links.length === 1 ? "link" : "links"}</span>
        <span className="text-green-500">✓</span>
        {totalPlaces > 0 && (
          <span className="text-gray-300">({totalPlaces} {t("linkList.places")})</span>
        )}
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
          <path fillRule="evenodd" d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
        </svg>
      </button>
    );
  }

  return (
    <div className="mt-2 space-y-1">
      {allProcessed && (
        <button
          onClick={() => setExpanded(false)}
          className="text-[10px] text-gray-300 hover:text-gray-500 transition-colors mb-1"
        >
          ▲ {t("linkList.collapse")}
        </button>
      )}
      {processingCount > 0 && (
        <div className="text-xs text-coral-500 animate-pulse mb-1">
          {t("linkList.processing", { count: processingCount })}
        </div>
      )}
      {links.map((link) => (
        <div
          key={link.id}
          className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-1.5 group"
        >
          <span
            className={`text-[9px] px-1 py-0.5 rounded text-white capitalize ${
              PLATFORM_COLORS[link.platform] || PLATFORM_COLORS.other
            }`}
          >
            {link.platform}
          </span>
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-gray-400 hover:text-coral-500 truncate flex-1"
          >
            {link.url}
          </a>
          <span className={`text-[10px] ${STATUS_LABELS[link.status]?.color || "text-gray-400"} ${STATUS_LABELS[link.status]?.animate ? "animate-pulse" : ""}`}>
            {STATUS_LABELS[link.status]?.text || link.status}
          </span>
          <button
            onClick={() => onDelete(link.id)}
            className="text-gray-200 hover:text-red-400 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
