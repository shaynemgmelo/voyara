export const VIBE_TAGS = {
  instagramavel: { label: "Instagramavel", color: "bg-pink-500/20 text-pink-300 border-pink-500/30" },
  hidden_gem: { label: "Hidden Gem", color: "bg-purple-500/20 text-purple-300 border-purple-500/30" },
  romantico: { label: "Romantico", color: "bg-rose-500/20 text-rose-300 border-rose-500/30" },
  comida_de_rua: { label: "Street Food", color: "bg-orange-500/20 text-orange-300 border-orange-500/30" },
  vida_noturna: { label: "Nightlife", color: "bg-indigo-500/20 text-indigo-300 border-indigo-500/30" },
  familiar: { label: "Family", color: "bg-green-500/20 text-green-300 border-green-500/30" },
  cultural: { label: "Cultural", color: "bg-amber-500/20 text-amber-300 border-amber-500/30" },
  ao_ar_livre: { label: "Outdoor", color: "bg-teal-500/20 text-teal-300 border-teal-500/30" },
  luxo: { label: "Luxury", color: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30" },
  economico: { label: "Budget", color: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" },
  historico: { label: "Historic", color: "bg-stone-500/20 text-stone-300 border-stone-500/30" },
  cafe_trabalho: { label: "Work Cafe", color: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30" },
  vista_panoramica: { label: "Scenic View", color: "bg-sky-500/20 text-sky-300 border-sky-500/30" },
};

/**
 * Get vibe tag info. Note: for translated labels, use t(`vibes.${key}`) from LanguageContext.
 * This function returns the static fallback label + color.
 */
export function getVibeTag(key) {
  return VIBE_TAGS[key] || { label: key, color: "bg-gray-500/20 text-gray-300 border-gray-500/30" };
}

export function getAllVibeTagKeys() {
  return Object.keys(VIBE_TAGS);
}
