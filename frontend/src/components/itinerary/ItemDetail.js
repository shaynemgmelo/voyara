import { useState, useEffect } from "react";
import { categoryIcon, formatDuration, renderStars } from "../../utils/formatters";
import { VIBE_TAGS } from "../../utils/vibeTags";
import { getNearbySuggestions } from "../../api/itineraryItems";
import { useLanguage } from "../../i18n/LanguageContext";

function mapsUrl(item) {
  if (item.google_place_id) {
    return `https://www.google.com/maps/place/?q=place_id:${item.google_place_id}`;
  }
  if (item.latitude) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.name)}+${item.latitude},${item.longitude}`;
  }
  return null;
}

function mapsEmbedUrl(item) {
  const key = process.env.REACT_APP_GOOGLE_MAPS_API_KEY;
  if (!key) return null;
  if (item.google_place_id) {
    return `https://www.google.com/maps/embed/v1/place?key=${key}&q=place_id:${item.google_place_id}&zoom=15`;
  }
  if (item.latitude) {
    return `https://www.google.com/maps/embed/v1/place?key=${key}&q=${item.latitude},${item.longitude}&zoom=15`;
  }
  return null;
}

export default function ItemDetail({
  item,
  tripId,
  onClose,
  onUpdate,
  onDelete,
  onAddNearby,
  // Optional: the matching entry from trip.traveler_profile.places_mentioned.
  // When provided, we surface its `community_notes` (aggregated creator
  // notes from every video that mentioned this place) and editorial summary.
  // The parent passes this so the user sees the same rich Wanderlog-style
  // notes here as they do in the PlaceDetailModal — paid the cost of the
  // Haiku extraction once, surface it everywhere.
  enrichedPlace = null,
}) {
  const { t, lang } = useLanguage();
  const pt = lang === "pt-BR";
  const [personalNotes, setPersonalNotes] = useState(item.personal_notes || "");
  const [nearby, setNearby] = useState([]);
  const [nearbyLoading, setNearbyLoading] = useState(false);
  const [sourcesExpanded, setSourcesExpanded] = useState(false);
  const gmapsLink = mapsUrl(item);
  const embedUrl = mapsEmbedUrl(item);

  // Build community_notes list from the enriched place (when present),
  // falling back to the item's own creator_note, then to nothing. We
  // also fold in editorial_summary + Haiku-generated rich_description
  // as the "About this place" block, plus practical_tips bullets.
  const editorialSummary = (enrichedPlace?.editorial_summary || "").trim();
  const richDescription = (enrichedPlace?.rich_description || "").trim();
  const practicalTips = Array.isArray(enrichedPlace?.practical_tips)
    ? enrichedPlace.practical_tips.filter((t) => (t || "").trim())
    : [];
  const communityNotes = (() => {
    const raw = enrichedPlace?.community_notes;
    if (Array.isArray(raw) && raw.length > 0) {
      return raw.filter((n) => n && (n.note || "").trim());
    }
    const fallback = (enrichedPlace?.creator_note || item.creator_note || "").trim();
    if (fallback) {
      return [{
        note: fallback,
        source_url: enrichedPlace?.source_url || item.source_url,
        source_platform: detectPlatform(enrichedPlace?.source_url || item.source_url),
      }];
    }
    return [];
  })();
  const uniqueSources = Array.from(
    new Set(communityNotes.map((n) => n.source_url).filter(Boolean)),
  );

  useEffect(() => {
    if (!item.latitude || !tripId) return;
    setNearbyLoading(true);
    getNearbySuggestions(tripId, item.day_plan_id, item.id)
      .then((data) => setNearby(data.suggestions || []))
      .catch(() => setNearby([]))
      .finally(() => setNearbyLoading(false));
  }, [item.id, item.latitude, item.day_plan_id, tripId]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 sm:bg-transparent flex items-end sm:items-stretch sm:justify-end"
      onClick={onClose}
    >
      <div
        className={
          // Mobile: bottom sheet pinned to the bottom edge with rounded
          // top corners and slide-up animation. Desktop: full-height
          // slide-out drawer pinned to the right edge.
          "bg-white shadow-2xl flex flex-col overflow-hidden " +
          "w-full max-h-[92vh] rounded-t-3xl animate-[slideUp_0.22s_ease-out] " +
          "sm:max-h-none sm:h-full sm:w-[440px] sm:rounded-none sm:animate-[slideRight_0.22s_ease-out]"
        }
        onClick={(e) => e.stopPropagation()}
      >
        {/* Mobile drag handle */}
        <div className="sm:hidden flex justify-center py-2 flex-shrink-0">
          <div className="w-10 h-1 rounded-full bg-gray-300" />
        </div>

        {/* Header */}
        <div className="sticky top-0 bg-white/95 backdrop-blur border-b border-gray-200 p-4 flex items-center justify-between z-10 flex-shrink-0">
          <h2 className="font-bold text-lg text-gray-900 truncate pr-4">
            {categoryIcon(item.category)} {item.name}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-900 text-xl"
            aria-label={pt ? "Fechar" : "Close"}
          >
            ✕
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto overscroll-contain">
        {/* Photos */}
        {item.photos && item.photos.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {item.photos.slice(0, 2).map((photoUrl, i) => (
              <img
                key={i}
                src={photoUrl}
                alt={`${item.name} photo ${i + 1}`}
                className="w-full h-32 object-cover rounded-lg"
                loading="lazy"
              />
            ))}
          </div>
        )}

        {/* Rating + Category badge */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {item.google_rating && (
              <>
                <span className="text-yellow-400 text-base">
                  {renderStars(parseFloat(item.google_rating))}
                </span>
                <span className="text-gray-700 text-sm font-medium">{item.google_rating}</span>
                {item.google_reviews_count && (
                  <span className="text-gray-400 text-xs">
                    ({item.google_reviews_count.toLocaleString()})
                  </span>
                )}
              </>
            )}
          </div>
          <span className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full capitalize">
            {item.category}
          </span>
        </div>

        {/* Quick info row */}
        <div className="flex items-center gap-4 text-sm">
          {item.time_slot && (
            <div className="flex items-center gap-1 text-gray-700">
              <span className="text-gray-400">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                  <path fillRule="evenodd" d="M8 15A7 7 0 108 1a7 7 0 000 14zm.75-10.25a.75.75 0 00-1.5 0v3.5c0 .199.079.39.22.53l2 2a.75.75 0 101.06-1.06L8.75 7.94V4.75z" clipRule="evenodd" />
                </svg>
              </span>
              {item.time_slot}
            </div>
          )}
          {item.duration_minutes && (
            <div className="text-gray-500">
              {formatDuration(item.duration_minutes)}
            </div>
          )}
          {item.pricing_info && (
            <div className="text-emerald-400 font-medium">{item.pricing_info}</div>
          )}
        </div>

        {/* Vibe tags */}
        {item.vibe_tags?.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {item.vibe_tags.map((tag) => {
              const info = VIBE_TAGS[tag] || { color: "bg-gray-500/20 text-gray-700 border-gray-500/30" };
              const label = t(`vibes.${tag}`) !== `vibes.${tag}` ? t(`vibes.${tag}`) : tag;
              return (
                <span key={tag} className={`text-xs px-2 py-0.5 rounded-full border ${info.color}`}>
                  {label}
                </span>
              );
            })}
          </div>
        )}

        {/* Alerts */}
        {item.alerts?.length > 0 && (
          <div className="space-y-1.5">
            {item.alerts.map((alert, i) => (
              <div key={i} className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                <span className="text-amber-400 text-sm mt-0.5">⚠</span>
                <span className="text-amber-700 text-sm">{alert}</span>
              </div>
            ))}
          </div>
        )}

        {/* Description */}
        {item.description && (
          <div>
            <p className="text-gray-700 text-sm leading-relaxed">{item.description}</p>
          </div>
        )}

        {/* About this place — preference order:
              1. richDescription (Haiku-generated, source-video-grounded)
              2. editorialSummary (Google's curated blurb)
            richDescription wins when present because it's tailored to
            the trip's source videos; editorialSummary is the fallback
            for places that never went through the Haiku batch run. */}
        {richDescription && (
          <div className="rounded-xl bg-amber-50 border border-amber-100 p-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-amber-700 mb-1.5">
              {pt ? "Sobre este lugar" : "About this place"}
            </div>
            <p className="text-sm text-gray-800 leading-relaxed">
              {richDescription}
            </p>
          </div>
        )}
        {editorialSummary && !richDescription && (
          <div className="rounded-xl bg-amber-50 border border-amber-100 p-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-amber-700 mb-1.5">
              {pt ? "Sobre este lugar" : "About this place"}
            </div>
            <p className="text-sm text-gray-800 leading-relaxed">
              {editorialSummary}
            </p>
          </div>
        )}

        {/* Practical tips — actionable bullets generated alongside
            richDescription by the Haiku batch run during reenrich.
            Hidden when empty so trips that haven't backfilled don't
            show an empty box. */}
        {practicalTips.length > 0 && (
          <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 mb-1.5">
              💡 {pt ? "Dicas práticas" : "Practical tips"}
            </div>
            <ul className="space-y-1.5">
              {practicalTips.map((tip, i) => (
                <li key={`tip-${i}`} className="flex gap-2 text-sm text-gray-800 leading-relaxed">
                  <span className="text-emerald-500 flex-shrink-0 mt-0.5">✓</span>
                  <span>{tip}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Notes from Community — aggregated bullets from EVERY video
            that mentioned this place. Each note carries an inline
            source-link icon, and a "Show sources • N" toggle expands
            the full list of source videos at the bottom. Mirrors the
            Wanderlog detail-card pattern the user explicitly asked for. */}
        {communityNotes.length > 0 && (
          <div className="rounded-xl bg-coral-50 border border-coral-100 p-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-coral-700 mb-1.5">
              {pt ? "Notas da Comunidade" : "Notes from the Community"}
            </div>
            <ul className="space-y-2">
              {communityNotes.map((n, i) => (
                <li key={i} className="flex gap-2 text-sm text-gray-800 leading-relaxed">
                  <span className="text-coral-400 flex-shrink-0 mt-0.5">•</span>
                  <div className="flex-1 min-w-0">
                    <span>{n.note}</span>
                    {n.source_url && (
                      <a
                        href={n.source_url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="ml-1.5 inline-flex items-center text-coral-600 hover:text-coral-700 text-[11px] align-middle"
                        title={n.source_url}
                      >
                        {sourceIconForUrl(n.source_url)}
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {uniqueSources.length > 0 && (
              <button
                type="button"
                onClick={() => setSourcesExpanded(!sourcesExpanded)}
                className="mt-3 inline-flex items-center gap-2 text-[11px] font-semibold text-coral-700 hover:text-coral-800"
              >
                <span>
                  {sourcesExpanded
                    ? (pt ? "Ocultar fontes" : "Hide sources")
                    : (pt ? `Mostrar fontes • ${uniqueSources.length}` : `Show sources • ${uniqueSources.length}`)}
                </span>
                <span className={`transition-transform ${sourcesExpanded ? "rotate-180" : ""}`}>▾</span>
              </button>
            )}
            {sourcesExpanded && uniqueSources.length > 0 && (
              <div className="mt-2 space-y-1.5 border-t border-coral-100 pt-2">
                {uniqueSources.map((s, i) => (
                  <a
                    key={i}
                    href={s}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 text-xs text-gray-600 hover:text-coral-600 truncate"
                  >
                    <span className="text-base flex-shrink-0">{sourceIconForUrl(s)}</span>
                    <span className="truncate">{shortSourceLabel(s)}</span>
                  </a>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Traveler tips / Notes */}
        {item.notes && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
            <p className="text-amber-700 text-sm leading-relaxed">{item.notes}</p>
          </div>
        )}

        {/* Personal notes */}
        <div className="bg-coral-50 border border-coral-200 rounded-lg p-3">
          <h3 className="text-xs font-semibold text-coral-600 uppercase mb-1.5 flex items-center gap-1">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
              <path d="M13.488 2.513a1.75 1.75 0 00-2.475 0L6.75 6.774a2.75 2.75 0 00-.596.892l-.848 2.047a.75.75 0 00.98.98l2.047-.848a2.75 2.75 0 00.892-.596l4.261-4.262a1.75 1.75 0 000-2.474z" />
              <path d="M4.75 3.5c-.69 0-1.25.56-1.25 1.25v6.5c0 .69.56 1.25 1.25 1.25h6.5c.69 0 1.25-.56 1.25-1.25V9A.75.75 0 0114 9v2.25A2.75 2.75 0 0111.25 14h-6.5A2.75 2.75 0 012 11.25v-6.5A2.75 2.75 0 014.75 2H7a.75.75 0 010 1.5H4.75z" />
            </svg>
            {t("itemForm.notes")}
          </h3>
          <textarea
            value={personalNotes}
            onChange={(e) => setPersonalNotes(e.target.value)}
            onBlur={() => {
              if (personalNotes !== (item.personal_notes || "")) {
                onUpdate({ personal_notes: personalNotes });
              }
            }}
            placeholder={t("itemDetail.notesPlaceholder")}
            rows={3}
            className="w-full bg-transparent text-coral-700 text-sm leading-relaxed resize-none outline-none placeholder-coral-400"
          />
        </div>

        {/* Google Maps button */}
        {gmapsLink && (
          <a
            href={gmapsLink}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 bg-coral-100 text-coral-600 hover:bg-coral-200 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path fillRule="evenodd" d="M9.69 18.933l.003.001C9.89 19.02 10 19 10 19s.11.02.308-.066l.002-.001.006-.003.018-.008a5.741 5.741 0 00.281-.14c.186-.096.446-.24.757-.433.62-.384 1.445-.966 2.274-1.765C15.302 14.988 17 12.493 17 9A7 7 0 103 9c0 3.492 1.698 5.988 3.355 7.584a13.731 13.731 0 002.273 1.765 11.842 11.842 0 00.976.544l.062.029.018.008.006.003zM10 11.25a2.25 2.25 0 100-4.5 2.25 2.25 0 000 4.5z" clipRule="evenodd" />
            </svg>
            Google Maps
          </a>
        )}

        {/* Mini map embed */}
        {embedUrl && (
          <div className="rounded-lg overflow-hidden border border-gray-200">
            <iframe
              title={`Map of ${item.name}`}
              src={embedUrl}
              width="100%"
              height="180"
              style={{ border: 0 }}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              allowFullScreen
            />
          </div>
        )}

        {/* Address — suppressed for experience items so the user doesn't
            read a tour-operator street address as "go to this agency". */}
        {(() => {
          const isExp =
            (Array.isArray(item.vibe_tags) && item.vibe_tags.includes("experiencia"))
            || item.activity_model === "guided_excursion"
            || item.visit_mode === "operator_based";
          if (isExp) {
            const where = item.city || item.primary_region || "";
            return (
              <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase mb-1">
                  {t("itemDetail.experienceLabel") || "Tipo"}
                </h3>
                <p className="text-violet-700 text-sm">
                  💡 {where ? `Sugestão de experiência em ${where}` : "Sugestão de experiência"}
                </p>
              </div>
            );
          }
          return item.address ? (
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase mb-1">{t("itemDetail.address")}</h3>
              <p className="text-gray-700 text-sm">{item.address}</p>
            </div>
          ) : null;
        })()}

        {/* Operating Hours */}
        {item.operating_hours && Object.keys(item.operating_hours).length > 0 && (
          <div>
            <div className="bg-gray-100 rounded-lg p-3 space-y-1">
              {Object.entries(item.operating_hours).map(([day, hours]) => (
                <div key={day} className="flex justify-between text-xs">
                  <span className="text-gray-500">{day}</span>
                  <span className="text-gray-700">{hours}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Contact & links */}
        {(item.phone || item.website) && (
          <div>
            <div className="space-y-1.5">
              {item.phone && (
                <a href={`tel:${item.phone}`} className="flex items-center gap-2 text-coral-600 text-sm hover:underline">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                    <path fillRule="evenodd" d="M3.855 2.018a.5.5 0 01.54.058l2 1.5A.5.5 0 016.5 4v1.586l1.293-1.293a.5.5 0 01.414-.137l2.5.5a.5.5 0 01.293.793l-3.5 4a.5.5 0 01-.793-.293l-.5-2.5A.5.5 0 016.344 6.5L7.93 4.914 6.5 3.882V4a.5.5 0 01-.146.354l-2 2A.5.5 0 014 6.5V4a.5.5 0 01-.145-.355z" clipRule="evenodd" />
                  </svg>
                  {item.phone}
                </a>
              )}
              {item.website && (
                <a
                  href={item.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-coral-600 text-sm hover:underline"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                    <path fillRule="evenodd" d="M8.914 6.025a.75.75 0 011.06 0 3.5 3.5 0 010 4.95l-2 2a3.5 3.5 0 01-4.95-4.95l1.25-1.25a.75.75 0 011.06 1.06L4.08 9.085a2 2 0 002.83 2.83l2-2a2 2 0 000-2.83.75.75 0 010-1.06zm-.829 3.95a.75.75 0 01-1.06 0 3.5 3.5 0 010-4.95l2-2a3.5 3.5 0 014.95 4.95l-1.25 1.25a.75.75 0 01-1.06-1.06l1.25-1.25a2 2 0 00-2.83-2.83l-2 2a2 2 0 000 2.83.75.75 0 010 1.06z" clipRule="evenodd" />
                  </svg>
                  <span className="truncate">{item.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}</span>
                </a>
              )}
            </div>
          </div>
        )}

        {/* Source link */}
        {item.source_url && (
          <div>
            <a
              href={item.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-coral-600 text-xs hover:underline truncate block"
            >
              {item.source_url}
            </a>
          </div>
        )}

        {/* Nearby suggestions */}
        {(nearby.length > 0 || nearbyLoading) && (
          <div>
            {nearbyLoading ? (
              <div className="text-xs text-gray-400">{t("itemDetail.loadingSuggestions")}</div>
            ) : (
              <div className="space-y-2">
                {nearby.map((s) => (
                  <div key={s.place_id} className="flex items-center gap-3 bg-gray-100 rounded-lg p-2">
                    {s.photo && (
                      <img src={s.photo} alt={s.name} className="w-12 h-12 rounded object-cover flex-shrink-0" loading="lazy" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-900 truncate">{s.name}</p>
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        {s.rating && <span className="text-yellow-400">{s.rating}</span>}
                        {s.distance && <span>{s.distance < 1000 ? `${s.distance}m` : `${(s.distance / 1000).toFixed(1)}km`}</span>}
                      </div>
                    </div>
                    {onAddNearby && (
                      <button
                        onClick={() => onAddNearby({
                          name: s.name,
                          category: s.category || "other",
                          google_place_id: s.place_id,
                          google_rating: s.rating,
                          latitude: s.latitude,
                          longitude: s.longitude,
                          address: s.address,
                          photos: s.photo ? [s.photo] : [],
                        })}
                        className="text-xs text-coral-600 hover:text-coral-500 flex-shrink-0"
                      >
                        {t("itemDetail.add")}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="pt-3 border-t border-gray-200 flex gap-3">
          <button
            onClick={onDelete}
            className="flex-1 bg-red-600/20 text-red-400 hover:bg-red-600/30 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            {t("itemDetail.delete")}
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}

// Helper: detect platform from a URL for the Notes from Community
// section's source-icon row.
function detectPlatform(url) {
  if (!url) return "other";
  if (url.includes("tiktok")) return "tiktok";
  if (url.includes("instagram")) return "instagram";
  if (url.includes("youtube") || url.includes("youtu.be")) return "youtube";
  return "other";
}

function sourceIconForUrl(url) {
  if (!url) return "🔗";
  if (url.includes("tiktok")) return "🎵";
  if (url.includes("instagram")) return "📸";
  if (url.includes("youtube") || url.includes("youtu.be")) return "▶️";
  return "🔗";
}

function shortSourceLabel(url) {
  if (!url) return "";
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host.includes("tiktok")) return "TikTok";
    if (host.includes("instagram")) return "Instagram";
    if (host.includes("youtube") || host.includes("youtu.be")) return "YouTube";
    return host;
  } catch {
    return url.length > 40 ? `${url.slice(0, 40)}…` : url;
  }
}
