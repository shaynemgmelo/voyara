import { useState } from "react";
import { useLanguage } from "../../i18n/LanguageContext";

export default function VibeTagFilter({ activeFilters, onToggle, availableTags }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);

  if (!availableTags || availableTags.length === 0) return null;

  const VIBE_COLORS = {
    instagramavel: "bg-pink-500/20 text-pink-300 border-pink-500/30",
    hidden_gem: "bg-purple-500/20 text-purple-300 border-purple-500/30",
    romantico: "bg-rose-500/20 text-rose-300 border-rose-500/30",
    comida_de_rua: "bg-orange-500/20 text-orange-300 border-orange-500/30",
    vida_noturna: "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
    familiar: "bg-green-500/20 text-green-300 border-green-500/30",
    cultural: "bg-amber-500/20 text-amber-300 border-amber-500/30",
    ao_ar_livre: "bg-teal-500/20 text-teal-300 border-teal-500/30",
    luxo: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
    economico: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
    historico: "bg-stone-500/20 text-stone-300 border-stone-500/30",
    cafe_trabalho: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
    vista_panoramica: "bg-sky-500/20 text-sky-300 border-sky-500/30",
  };

  // Collapsed: show filter icon + active count
  if (!open) {
    return (
      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
            <path d="M14 2a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v2.172a2 2 0 0 0 .586 1.414l3.828 3.828A1 1 0 0 1 6.828 10v3.266a.5.5 0 0 0 .757.429l2-1.2A.5.5 0 0 0 9.828 12V10a1 1 0 0 1 .293-.707l3.828-3.828A2 2 0 0 0 14.535 4.05V2Z" />
          </svg>
          {t("vibeFilter.label")}
        </button>
        {activeFilters.length > 0 && (
          <>
            <span className="text-[10px] bg-coral-100 text-coral-600 px-1.5 py-0.5 rounded-full font-medium">
              {activeFilters.length}
            </span>
            <button
              onClick={() => onToggle(null)}
              className="text-[10px] text-gray-300 hover:text-gray-500 transition-colors"
            >
              ✕
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="mb-3">
      <div className="flex items-center gap-2 mb-2">
        <button
          onClick={() => setOpen(false)}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
            <path d="M14 2a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v2.172a2 2 0 0 0 .586 1.414l3.828 3.828A1 1 0 0 1 6.828 10v3.266a.5.5 0 0 0 .757.429l2-1.2A.5.5 0 0 0 9.828 12V10a1 1 0 0 1 .293-.707l3.828-3.828A2 2 0 0 0 14.535 4.05V2Z" />
          </svg>
          {t("vibeFilter.label")}
        </button>
        {activeFilters.length > 0 && (
          <button
            onClick={() => onToggle(null)}
            className="text-[10px] text-gray-400 hover:text-gray-600 transition-colors"
          >
            {t("vibeFilter.clear")}
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        {availableTags.map((tag) => {
          const color = VIBE_COLORS[tag] || "bg-gray-500/20 text-gray-700 border-gray-500/30";
          const label = t(`vibes.${tag}`) !== `vibes.${tag}` ? t(`vibes.${tag}`) : tag;
          const isActive = activeFilters.includes(tag);
          return (
            <button
              key={tag}
              onClick={() => onToggle(tag)}
              className={`text-[10px] px-2 py-0.5 rounded-full border transition-all ${
                isActive
                  ? color + " border-current"
                  : "bg-white text-gray-400 border-gray-200 hover:text-gray-600"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
