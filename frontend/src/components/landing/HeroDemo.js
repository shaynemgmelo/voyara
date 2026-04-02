import { useState, useEffect, useCallback } from "react";
import { useLanguage } from "../../i18n/LanguageContext";
import ShowcaseMap from "./ShowcaseMap";

/*
 * Wide-format animated walkthrough — shows every feature step
 * as if a user is navigating through the real app.
 * NOT inside a phone — full width like a desktop app preview.
 * Matches the /features page steps.
 */

const SCENES = [
  { id: "dream",     duration: 3000 },
  { id: "paste",     duration: 3500 },
  { id: "discover",  duration: 3500 },
  { id: "profile",   duration: 3500 },
  { id: "itinerary", duration: 5000 },
  { id: "customize", duration: 3500 },
  { id: "map",       duration: 4000 },
  { id: "details",   duration: 3500 },
  { id: "extras",    duration: 3500 },
  { id: "share",     duration: 3000 },
  { id: "closing",   duration: 2500 },
];
const TOTAL_DURATION = SCENES.reduce((a, s) => a + s.duration, 0);

export default function HeroDemo() {
  const { lang } = useLanguage();
  const pt = lang === "pt-BR";

  const [sceneIdx, setSceneIdx] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  const restart = useCallback(() => {
    setSceneIdx(0);
    setElapsed(0);
  }, []);

  useEffect(() => {
    const tick = 40;
    const interval = setInterval(() => {
      setElapsed((prev) => {
        const next = prev + tick;
        let acc = 0;
        for (let i = 0; i < SCENES.length; i++) {
          acc += SCENES[i].duration;
          if (next < acc) { setSceneIdx(i); return next; }
        }
        restart();
        return 0;
      });
    }, tick);
    return () => clearInterval(interval);
  }, [restart]);

  let accBefore = 0;
  for (let i = 0; i < sceneIdx; i++) accBefore += SCENES[i].duration;
  const p = Math.min(1, (elapsed - accBefore) / SCENES[sceneIdx].duration);
  const totalProgress = elapsed / TOTAL_DURATION;
  const scene = SCENES[sceneIdx].id;

  const STEP_LABELS = [
    { id: "dream", icon: "📱", label: pt ? "Copiar" : "Copy" },
    { id: "paste", icon: "🔗", label: pt ? "Colar" : "Paste" },
    { id: "discover", icon: "✨", label: pt ? "Descobrir" : "Discover" },
    { id: "profile", icon: "🎯", label: pt ? "Perfil" : "Profile" },
    { id: "itinerary", icon: "📋", label: pt ? "Roteiro" : "Itinerary" },
    { id: "customize", icon: "✏️", label: pt ? "Editar" : "Edit" },
    { id: "map", icon: "🗺️", label: pt ? "Mapa" : "Map" },
    { id: "details", icon: "💎", label: pt ? "Detalhes" : "Details" },
    { id: "extras", icon: "✈️", label: pt ? "Extras" : "Extras" },
    { id: "share", icon: "📤", label: pt ? "Salvar" : "Save" },
    { id: "closing", icon: "🚀", label: "" },
  ];

  return (
    <div className="w-full max-w-5xl mx-auto">
      {/* Browser-like wrapper */}
      <div className="rounded-2xl overflow-hidden shadow-2xl border border-gray-200 bg-white">
        {/* Browser bar */}
        <div className="bg-gray-50 border-b border-gray-200 px-4 py-2.5 flex items-center gap-3">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-red-400" />
            <div className="w-3 h-3 rounded-full bg-yellow-400" />
            <div className="w-3 h-3 rounded-full bg-green-400" />
          </div>
          <div className="flex-1 bg-white rounded-lg px-4 py-1 text-xs text-gray-400 text-center border border-gray-200 max-w-md mx-auto flex items-center justify-center gap-2">
            <span className="text-gray-300">🔒</span>
            voyara.app
          </div>
        </div>

        {/* Step progress bar */}
        <div className="bg-white border-b border-gray-100 px-4 py-2 flex items-center gap-1 overflow-x-auto scrollbar-hide">
          {STEP_LABELS.filter(s => s.label).map((s, i) => {
            const done = SCENES.findIndex(sc => sc.id === s.id) < sceneIdx;
            const active = scene === s.id;
            return (
              <div key={s.id} className={`flex items-center gap-1 px-2 py-1 rounded-full text-[9px] font-semibold whitespace-nowrap transition-all duration-300 ${
                active ? "bg-coral-500 text-white shadow-sm" : done ? "bg-coral-50 text-coral-500" : "text-gray-400"
              }`}>
                <span className="text-[10px]">{s.icon}</span>
                <span className="hidden sm:inline">{s.label}</span>
              </div>
            );
          })}
          {/* Progress line */}
          <div className="flex-1" />
          <div className="text-[9px] text-gray-400 tabular-nums font-mono">{Math.round(totalProgress * 100)}%</div>
        </div>

        {/* Main content area */}
        <div className="relative overflow-hidden" style={{ aspectRatio: "16/9", minHeight: 320 }}>
          {/* Total progress bar */}
          <div className="absolute top-0 left-0 right-0 z-50 h-0.5 bg-gray-100">
            <div className="h-full bg-gradient-to-r from-coral-500 to-violet-500 transition-all duration-75 ease-linear" style={{ width: `${totalProgress * 100}%` }} />
          </div>

          <SW a={scene === "dream"} n={scene === "paste"}><DreamScene p={p} pt={pt} /></SW>
          <SW a={scene === "paste"} n={scene === "discover"}><PasteScene p={p} pt={pt} /></SW>
          <SW a={scene === "discover"} n={scene === "profile"}><DiscoverScene p={p} pt={pt} /></SW>
          <SW a={scene === "profile"} n={scene === "itinerary"}><ProfileScene p={p} pt={pt} /></SW>
          <SW a={scene === "itinerary"} n={scene === "customize"}><ItineraryScene p={p} pt={pt} /></SW>
          <SW a={scene === "customize"} n={scene === "map"}><CustomizeScene p={p} pt={pt} /></SW>
          <SW a={scene === "map"} n={scene === "details"}><MapScene p={p} pt={pt} /></SW>
          <SW a={scene === "details"} n={scene === "extras"}><DetailsScene p={p} pt={pt} /></SW>
          <SW a={scene === "extras"} n={scene === "share"}><ExtrasScene p={p} pt={pt} /></SW>
          <SW a={scene === "share"} n={scene === "closing"}><ShareScene p={p} pt={pt} /></SW>
          <SW a={scene === "closing"} n={false}><ClosingScene p={p} pt={pt} /></SW>
        </div>
      </div>
    </div>
  );
}

/* ══ Transition wrapper ══ */
function SW({ a, n, children }) {
  return (
    <div className={`absolute inset-0 transition-all duration-500 ${
      a ? "opacity-100 translate-x-0" : n ? "opacity-0 -translate-x-4" : "opacity-0 translate-x-4 pointer-events-none"
    }`}>
      {children}
    </div>
  );
}

/* ══════════════════════════════════════════
   Scene: DREAM — TikTok-like UI, user copies link
══════════════════════════════════════════ */
function DreamScene({ p, pt }) {
  const showShare = p > 0.3;
  const showCopy = p > 0.55;
  const showCopied = p > 0.75;

  return (
    <div className="h-full relative overflow-hidden bg-black">
      {/* Background: Paris video thumbnail */}
      <img
        src="https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=900&h=500&fit=crop&q=80"
        alt=""
        className="absolute inset-0 w-full h-full object-cover"
        style={{ transform: "scale(1.03)", filter: showShare ? "brightness(0.4)" : "brightness(0.7)" }}
        loading="eager"
      />

      {/* TikTok-style UI overlay */}
      <div className="absolute inset-0 flex">
        {/* Left: Video content */}
        <div className="flex-1 relative flex flex-col justify-end p-5 sm:p-8">
          {/* TikTok logo + creator info */}
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 rounded-full bg-white/20 backdrop-blur-sm border border-white/40 overflow-hidden flex items-center justify-center">
              <span className="text-sm">🌍</span>
            </div>
            <span className="text-white text-sm font-bold">@paris.voyages</span>
            <span className="bg-coral-500 text-white text-[9px] px-2 py-0.5 rounded font-bold" style={{ opacity: p > 0.1 ? 1 : 0 }}>Follow</span>
          </div>
          <p className="text-white text-base sm:text-lg font-bold leading-snug max-w-sm">
            {pt ? "7 dias em Paris que mudaram minha vida" : "7 days in Paris that changed my life"} ✨🗼
          </p>
          <div className="flex items-center gap-2 mt-1.5">
            <span className="text-white/60 text-xs">#paris #travel #travelguide #europe</span>
          </div>
          <div className="flex items-center gap-1 mt-2">
            <div className="h-0.5 bg-white/30 rounded-full flex-1 max-w-[200px]">
              <div className="h-full bg-white rounded-full" style={{ width: `${Math.min(100, p * 130)}%`, transition: "width 0.1s" }} />
            </div>
            <span className="text-white/40 text-[10px] font-mono">0:{String(Math.min(28, Math.floor(p * 36))).padStart(2, '0')}</span>
          </div>
        </div>

        {/* Right: TikTok action buttons */}
        <div className="w-14 sm:w-16 flex flex-col items-center justify-end pb-8 gap-4">
          {[
            { icon: "❤️", count: "847K", active: true },
            { icon: "💬", count: "2.1K" },
            { icon: "🔖", count: "156K" },
            { icon: "↗️", count: pt ? "Enviar" : "Share", highlight: showShare },
          ].map((btn, i) => (
            <div key={i} className={`flex flex-col items-center gap-0.5 transition-all duration-300 ${btn.highlight ? "scale-125" : ""}`}>
              <div className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center transition-all duration-300 ${
                btn.highlight ? "bg-white/30 backdrop-blur-sm ring-2 ring-white/60" : "bg-white/10"
              }`}>
                <span className="text-lg sm:text-xl">{btn.icon}</span>
              </div>
              <span className="text-white/80 text-[9px] font-semibold">{btn.count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Share menu overlay */}
      {showShare && (
        <div className="absolute inset-0 flex items-end justify-center z-20">
          <div
            className="bg-gray-900/95 backdrop-blur-lg rounded-t-3xl w-full max-w-md px-6 pt-5 pb-8"
            style={{ transform: `translateY(${showShare ? 0 : 100}%)`, transition: "transform 0.4s ease-out" }}
          >
            <div className="w-10 h-1 rounded-full bg-white/20 mx-auto mb-5" />
            <p className="text-white/70 text-xs text-center font-medium mb-4">
              {pt ? "Compartilhar com" : "Share to"}
            </p>
            <div className="grid grid-cols-4 gap-3 mb-5">
              {[
                { icon: "💬", name: "WhatsApp", color: "bg-green-500" },
                { icon: "✉️", name: "Messages", color: "bg-blue-500" },
                { icon: "📋", name: pt ? "Copiar link" : "Copy link", color: "bg-gray-600", highlight: true },
                { icon: "🔗", name: "Voyara", color: "bg-coral-500" },
              ].map((opt, i) => (
                <div key={i} className="flex flex-col items-center gap-1.5">
                  <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-300 ${opt.color} ${
                    opt.highlight && showCopy ? "ring-2 ring-white scale-110" : ""
                  }`}>
                    <span className="text-xl">{opt.icon}</span>
                  </div>
                  <span className="text-white/60 text-[9px] text-center leading-tight">{opt.name}</span>
                </div>
              ))}
            </div>

            {/* Copied feedback */}
            {showCopied && (
              <div className="flex items-center justify-center gap-2 bg-green-500/20 border border-green-500/30 rounded-xl py-2.5 px-4 animate-fadeInUp">
                <span className="text-green-400 text-sm">✓</span>
                <span className="text-green-300 text-xs font-bold">
                  {pt ? "Link copiado!" : "Link copied!"}
                </span>
                <span className="text-green-400/60 text-[10px] font-mono ml-1 truncate max-w-[180px]">tiktok.com/@paris.voyages/72...</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════
   Scene: PASTE — Link pasted, places extracted
══════════════════════════════════════════ */
function PasteScene({ p, pt }) {
  const places = ["Torre Eiffel", "Sacré-Cœur", "Le Marais", "Montmartre", "Pont Alexandre III", "Café de Flore", "Tuileries", "Arc de Triomphe"];
  const visPlaces = Math.min(places.length, Math.floor(p * 14));

  return (
    <div className="h-full bg-white flex flex-col items-center justify-center px-8 sm:px-16">
      <div className="w-full max-w-lg">
        {/* Input */}
        <div className="mb-4">
          <div className={`border-2 rounded-xl px-4 py-3 flex items-center gap-3 transition-all duration-300 ${p > 0.15 ? "border-coral-400 shadow-lg shadow-coral-100" : "border-gray-200"}`}>
            <span className="text-gray-400">🔗</span>
            <div className="flex-1 text-sm text-gray-700 font-mono truncate">
              <TypeWriter text="https://instagram.com/reel/C9kL2m_paris..." progress={Math.min(1, p * 4)} />
            </div>
            <span className="text-[9px] bg-pink-100 text-pink-600 px-2 py-0.5 rounded-full font-bold" style={{ opacity: p > 0.2 ? 1 : 0 }}>Instagram</span>
          </div>
        </div>

        {/* Analyzing button */}
        <div className={`text-center py-3 rounded-xl font-bold text-sm transition-all duration-300 mb-5 ${
          p > 0.25 ? "bg-coral-500 text-white shadow-lg shadow-coral-200" : "bg-gray-200 text-gray-400"
        }`}>
          {p > 0.25 ? (pt ? "✨ Analisando..." : "✨ Analyzing...") : (pt ? "Analisar" : "Analyze")}
        </div>

        {/* Extracted places */}
        {p > 0.35 && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4" style={{ opacity: p > 0.35 ? 1 : 0, transition: "opacity 0.3s" }}>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-emerald-600">✓</span>
              <span className="text-sm font-bold text-emerald-700">
                {visPlaces > 0 ? `${visPlaces} ${pt ? "lugares encontrados!" : "places found!"}` : (pt ? "Buscando..." : "Searching...")}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {places.slice(0, visPlaces).map((pl, i) => (
                <span key={i} className="bg-white text-xs text-gray-600 px-2.5 py-1 rounded-full border border-emerald-200 font-medium animate-fadeInUp"
                  style={{ animationDelay: `${i * 60}ms` }}>
                  📍 {pl}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════
   Scene: DISCOVER — AI finds hidden gems
══════════════════════════════════════════ */
function DiscoverScene({ p, pt }) {
  const items = [
    { name: "Rue Crémieux", img: "https://images.unsplash.com/photo-1550340499-a6c60fc8287c?w=100&h=100&fit=crop&q=80", tag: pt ? "📸 Do vídeo" : "📸 From video", tagC: "bg-blue-100 text-blue-700", rating: "4.3", desc: pt ? "A rua mais colorida de Paris" : "Paris' most colorful street" },
    { name: "Café de Flore", img: "https://images.unsplash.com/photo-1514933651103-005eec06c04b?w=100&h=100&fit=crop&q=80", tag: pt ? "📸 Do vídeo" : "📸 From video", tagC: "bg-blue-100 text-blue-700", rating: "4.2", desc: pt ? "Onde Hemingway escrevia" : "Where Hemingway wrote" },
    { name: "Le Bouillon Chartier", img: "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=100&h=100&fit=crop&q=80", tag: pt ? "💎 IA encontrou" : "💎 AI found", tagC: "bg-amber-100 text-amber-700", rating: "4.5", desc: pt ? "Pratos tradicionais a €12!" : "Traditional dishes from €12!" },
    { name: "Parc des Buttes-Chaumont", img: "https://images.unsplash.com/photo-1585944672394-80f0a9565cce?w=100&h=100&fit=crop&q=80", tag: pt ? "💎 IA encontrou" : "💎 AI found", tagC: "bg-amber-100 text-amber-700", rating: "4.7", desc: pt ? "O parque secreto — zero turista" : "The secret park — zero tourists" },
  ];
  const vis = Math.min(items.length, Math.floor(p * 6));

  return (
    <div className="h-full bg-gradient-to-b from-violet-50 to-white flex items-center justify-center px-6">
      <div className="w-full max-w-xl">
        <div className="text-center mb-5" style={{ opacity: p > 0.05 ? 1 : 0, transition: "opacity 0.3s" }}>
          <span className="text-2xl">✨</span>
          <h3 className="text-base font-extrabold text-gray-900 mt-1">
            {pt ? "A IA encontrou lugares que o vídeo não mostrou" : "AI found places the video didn't show"}
          </h3>
        </div>
        <div className="space-y-2.5">
          {items.slice(0, vis).map((item, i) => (
            <div key={i} className="bg-white rounded-xl p-3 shadow-sm flex items-center gap-3 animate-slideInRight" style={{ animationDelay: `${i * 100}ms` }}>
              <img src={item.img} alt="" className="w-12 h-12 rounded-lg object-cover flex-shrink-0" loading="lazy" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-sm font-bold text-gray-900">{item.name}</span>
                  <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded-full ${item.tagC}`}>{item.tag}</span>
                </div>
                <p className="text-xs text-gray-500">{item.desc}</p>
              </div>
              <span className="text-amber-500 text-xs font-bold">★ {item.rating}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════
   Scene: PROFILE — Traveler profile detected
══════════════════════════════════════════ */
function ProfileScene({ p, pt }) {
  const interests = [
    { emoji: "🍽️", label: pt ? "Gastronomia" : "Food", on: true },
    { emoji: "📸", label: pt ? "Fotografia" : "Photography", on: true },
    { emoji: "🌅", label: pt ? "Mirantes" : "Viewpoints", on: true },
    { emoji: "☕", label: pt ? "Cafés" : "Cafes", on: true },
    { emoji: "🏛️", label: pt ? "Museus" : "Museums", on: false },
    { emoji: "🌳", label: pt ? "Natureza" : "Nature", on: true },
  ];
  const visInterests = Math.min(interests.length, Math.floor(p * 10));

  return (
    <div className="h-full bg-gradient-to-b from-emerald-50 to-white flex items-center justify-center px-6">
      <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md">
        <div className="flex items-center gap-3 mb-5">
          <img src="https://images.unsplash.com/photo-1539635278303-d4002c07eae3?w=80&h=80&fit=crop&q=80" alt="" className="w-12 h-12 rounded-xl object-cover" loading="lazy" />
          <div>
            <div className="text-base font-bold text-gray-900">{pt ? "Seu Perfil de Viajante" : "Your Traveler Profile"}</div>
            <div className="text-xs text-gray-400">{pt ? "Baseado nos seus links" : "Based on your links"}</div>
          </div>
        </div>

        <div className="bg-emerald-50 rounded-xl p-3 mb-4 border border-emerald-200" style={{ opacity: p > 0.1 ? 1 : 0, transition: "opacity 0.3s" }}>
          <p className="text-xs text-emerald-800">
            {pt ? "🎒 Viajante aventureiro que ama gastronomia local e fotografia de rua. Gosta de pôr do sol nos mirantes." : "🎒 Adventurous traveler who loves local food and street photography. Enjoys sunset viewpoints."}
          </p>
        </div>

        <div className="mb-4">
          <div className="text-[10px] text-gray-400 font-semibold uppercase mb-2">{pt ? "O que você curte" : "What you enjoy"}</div>
          <div className="flex flex-wrap gap-1.5">
            {interests.slice(0, visInterests).map((t, i) => (
              <span key={i} className={`text-[10px] font-semibold px-2.5 py-1 rounded-full border animate-fadeInUp ${t.on ? "bg-emerald-50 text-emerald-700 border-emerald-300" : "bg-gray-50 text-gray-400 border-gray-200"}`}
                style={{ animationDelay: `${i * 60}ms` }}>
                {t.emoji} {t.label}
              </span>
            ))}
          </div>
        </div>

        <div className="flex gap-2 mb-4">
          {[
            { label: pt ? "🐢 Relaxado" : "🐢 Relaxed", on: false },
            { label: pt ? "🚶 Moderado" : "🚶 Moderate", on: true },
            { label: pt ? "🏃 Intenso" : "🏃 Intense", on: false },
          ].map((pace, i) => (
            <span key={i} className={`text-[10px] font-bold px-3 py-1.5 rounded-xl ${pace.on ? "bg-emerald-500 text-white" : "bg-gray-100 text-gray-400"}`}
              style={{ opacity: p > 0.4 + i * 0.1 ? 1 : 0, transition: "opacity 0.3s" }}>
              {pace.label}
            </span>
          ))}
        </div>

        <button className="w-full bg-emerald-500 text-white font-bold py-3 rounded-xl text-sm"
          style={{ opacity: p > 0.7 ? 1 : 0, transform: `translateY(${p > 0.7 ? 0 : 8}px)`, transition: "all 0.3s" }}>
          {pt ? "✓ Confirmar e Gerar Roteiro" : "✓ Confirm & Generate Itinerary"}
        </button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════
   Scene: ITINERARY — Day-by-day with real places
══════════════════════════════════════════ */
function ItineraryScene({ p, pt }) {
  const items = [
    { emoji: "☕", name: "Café des Deux Moulins", dur: "~45min", rating: "4.4", img: "https://images.unsplash.com/photo-1554118811-1e0d58224f24?w=80&h=80&fit=crop&q=80", tag: pt ? "Café da manhã" : "Breakfast", tagC: "bg-blue-50 text-blue-600" },
    { emoji: "⛪", name: "Sacré-Cœur", dur: "~1h", rating: "4.7", img: "https://images.unsplash.com/photo-1568684333877-4d39f2b589b8?w=80&h=80&fit=crop&q=80", tag: "🌅", tagC: "bg-orange-50 text-orange-600" },
    { emoji: "🎨", name: "Place du Tertre", dur: "~30min", rating: "4.3", img: "https://images.unsplash.com/photo-1541882131556-7e0b45407e67?w=80&h=80&fit=crop&q=80" },
    { emoji: "🍽️", name: "Le Bouillon Chartier", dur: "~1h15", rating: "4.5", img: "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=80&h=80&fit=crop&q=80", tag: "💎", tagC: "bg-amber-50 text-amber-700" },
    { emoji: "🖼️", name: pt ? "Museu de l'Orangerie" : "Musée de l'Orangerie", dur: "~40min", rating: "4.6", img: "https://images.unsplash.com/photo-1499426600726-7f5b4e56e3b4?w=80&h=80&fit=crop&q=80" },
    { emoji: "🌅", name: "Pont Alexandre III", dur: "~30min", rating: "4.8", img: "https://images.unsplash.com/photo-1499856871958-5b9627545d1a?w=80&h=80&fit=crop&q=80", tag: "🌅", tagC: "bg-orange-50 text-orange-600" },
  ];
  const vis = Math.min(items.length, Math.floor(p * 9));

  return (
    <div className="h-full bg-white flex">
      {/* Left panel — itinerary */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Day header */}
        <div className="bg-gradient-to-r from-coral-500 to-orange-500 px-5 py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center text-white text-sm font-black">1</div>
          <div>
            <div className="text-white text-sm font-bold">{pt ? "Dia 1 — Montmartre & Sacré-Cœur" : "Day 1 — Montmartre & Sacré-Cœur"}</div>
            <div className="text-white/60 text-[10px]">{pt ? "Segunda, 14 de julho • 6 lugares" : "Monday, July 14 • 6 places"}</div>
          </div>
        </div>

        {/* Items */}
        <div className="flex-1 overflow-hidden px-4 py-3">
          <div className="space-y-2">
            {items.slice(0, vis).map((item, i) => (
              <div key={i} className="flex items-center gap-3 animate-slideInRight" style={{ animationDelay: `${i * 80}ms` }}>
                <img src={item.img} alt="" className="w-10 h-10 rounded-lg object-cover flex-shrink-0 shadow-sm" loading="lazy" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-gray-900">{item.emoji} {item.name}</span>
                    {item.tag && <span className={`text-[7px] font-bold px-1.5 py-0.5 rounded-full ${item.tagC}`}>{item.tag}</span>}
                  </div>
                  <div className="flex items-center gap-2 text-[10px] mt-0.5">
                    <span className="text-amber-500 font-bold">★ {item.rating}</span>
                    <span className="text-gray-400">{item.dur}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Other days */}
        <div className="border-t border-gray-100 px-4 py-2 flex items-center gap-2">
          {[
            { n: "2", label: pt ? "Marais & Île" : "Marais & Île", color: "bg-violet-500" },
            { n: "3", label: pt ? "Louvre & Ópera" : "Louvre & Opéra", color: "bg-emerald-500" },
            { n: "4", label: "Versailles", color: "bg-amber-500" },
          ].map(d => (
            <span key={d.n} className="flex items-center gap-1 bg-gray-50 rounded-lg px-2 py-1.5">
              <span className={`w-5 h-5 rounded-md ${d.color} text-white text-[9px] font-bold flex items-center justify-center`}>{d.n}</span>
              <span className="text-[9px] text-gray-500 font-medium">{d.label}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Right panel — mini map preview */}
      <div className="hidden sm:flex w-64 border-l border-gray-100 bg-emerald-50/30 flex-col">
        <div className="flex-1 relative">
          <div className="absolute inset-0 bg-gradient-to-br from-green-100 via-blue-50 to-green-50">
            <div className="absolute top-[35%] left-0 right-0 h-2 bg-blue-200/50 transform -rotate-2" />
          </div>
          {/* Pins appearing */}
          {items.slice(0, vis).map((_, i) => {
            const positions = [
              { x: 30, y: 20 }, { x: 50, y: 25 }, { x: 35, y: 40 },
              { x: 60, y: 50 }, { x: 45, y: 65 }, { x: 55, y: 75 },
            ];
            const pos = positions[i] || { x: 50, y: 50 };
            return (
              <div key={i} className="absolute z-10" style={{ left: `${pos.x}%`, top: `${pos.y}%`, transform: "translate(-50%, -100%)" }}>
                <div className="w-5 h-5 rounded-full bg-coral-500 border-2 border-white shadow-md flex items-center justify-center text-white text-[7px] font-bold">
                  {i + 1}
                </div>
              </div>
            );
          })}
        </div>
        <div className="p-2 text-center text-[9px] text-gray-400 bg-white border-t border-gray-100">
          Google Maps
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════
   Scene: CUSTOMIZE — Refine with AI
══════════════════════════════════════════ */
function CustomizeScene({ p, pt }) {
  return (
    <div className="h-full bg-gradient-to-b from-amber-50 to-white flex items-center justify-center px-6">
      <div className="w-full max-w-lg space-y-4">
        {/* AI feedback */}
        <div className="bg-white rounded-2xl shadow-xl p-5">
          <div className="text-sm font-bold text-gray-900 mb-3">✏️ {pt ? "Refinar com IA" : "Refine with AI"}</div>
          <div className="bg-amber-50 rounded-xl p-3 border border-amber-200 mb-3">
            <p className="text-xs text-amber-800">
              <TypeWriter
                text={pt ? "Tira o museu e coloca mais um café legal. Quero jantar com vista pra Torre Eiffel." : "Remove the museum and add a cool café. I want dinner with Eiffel Tower views."}
                progress={Math.min(1, p * 2.5)}
              />
            </p>
          </div>
          <div className={`bg-coral-500 text-white text-center text-xs font-bold py-2.5 rounded-xl transition-all duration-300 ${p > 0.4 ? "shadow-lg shadow-coral-200" : ""}`}>
            {p > 0.4 ? (pt ? "✨ Refinando..." : "✨ Refining...") : (pt ? "Refinar" : "Refine")}
          </div>
        </div>

        {/* Swap preview */}
        {p > 0.55 && (
          <div className="bg-white rounded-2xl shadow-xl p-4 animate-fadeInUp">
            <div className="text-[10px] text-gray-400 font-semibold uppercase mb-2">{pt ? "Trocando lugar" : "Swapping place"}</div>
            <div className="flex items-center gap-3">
              <div className="flex-1 bg-red-50 rounded-lg p-2.5 text-center border border-red-200">
                <div className="text-xs font-bold text-red-500 line-through">{pt ? "Museu de l'Orangerie" : "Musée de l'Orangerie"}</div>
                <div className="text-[9px] text-red-400">★ 4.6 • ~40min</div>
              </div>
              <span className="text-gray-400 text-xl font-light">→</span>
              <div className="flex-1 bg-emerald-50 rounded-lg p-2.5 text-center border border-emerald-200">
                <div className="text-xs font-bold text-emerald-700">Shakespeare & Co.</div>
                <div className="text-[9px] text-emerald-500">★ 4.6 • ~30min</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════
   Scene: MAP — Real Google Maps with animated pins & routes
══════════════════════════════════════════ */
function MapScene({ p, pt }) {
  const visPins = Math.min(18, Math.floor(p * 30));
  const showRoutes = p > 0.35;
  const showHotel = p > 0.1;
  const showHotelInfo = p > 0.6;

  return (
    <div className="h-full relative overflow-hidden">
      <ShowcaseMap
        className="w-full h-full"
        visiblePins={visPins}
        showRoutes={showRoutes}
        showHotel={showHotel}
        showHotelInfo={showHotelInfo}
        zoom={13}
      >
        {/* Distance badges */}
        <div className="absolute top-3 left-4 flex gap-1.5 z-30 pointer-events-none">
          <span className="bg-orange-500 text-white text-[9px] font-bold px-2.5 py-1 rounded-full shadow-lg"
            style={{ opacity: p > 0.2 ? 1 : 0, transition: "opacity 0.3s" }}>
            {pt ? "Dia 1 • 9,9 km" : "Day 1 • 9.9 km"}
          </span>
          <span className="bg-blue-500 text-white text-[9px] font-bold px-2.5 py-1 rounded-full shadow-lg"
            style={{ opacity: p > 0.4 ? 1 : 0, transition: "opacity 0.3s" }}>
            {pt ? "Dia 2 • 4,9 km" : "Day 2 • 4.9 km"}
          </span>
          <span className="bg-emerald-500 text-white text-[9px] font-bold px-2.5 py-1 rounded-full shadow-lg"
            style={{ opacity: p > 0.55 ? 1 : 0, transition: "opacity 0.3s" }}>
            {pt ? "Dia 3 • 6,0 km" : "Day 3 • 6.0 km"}
          </span>
        </div>

        {/* Trip info card */}
        <div className="absolute bottom-3 left-4 right-4 z-20 pointer-events-none"
          style={{ opacity: p > 0.7 ? 1 : 0, transform: `translateY(${p > 0.7 ? 0 : 8}px)`, transition: "all 0.4s" }}>
          <div className="bg-white/95 backdrop-blur-md rounded-xl shadow-xl border border-gray-200 p-3 flex items-center justify-between">
            <div>
              <div className="text-sm font-bold text-gray-900">{pt ? "5 dias em Paris" : "5-Day Paris Trip"}</div>
              <div className="text-[10px] text-gray-500">18 {pt ? "lugares" : "spots"} • 3 {pt ? "rotas" : "routes"}</div>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex gap-1">
                <div className="w-2.5 h-2.5 rounded-full bg-orange-500" />
                <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
              </div>
              <span className="bg-blue-600 text-white text-[9px] font-bold px-2 py-1.5 rounded-lg">Google Maps ↗</span>
            </div>
          </div>
        </div>
      </ShowcaseMap>
    </div>
  );
}

/* ══════════════════════════════════════════
   Scene: DETAILS — Place sidebar with tips
══════════════════════════════════════════ */
function DetailsScene({ p, pt }) {
  return (
    <div className="h-full bg-white flex">
      {/* Left — blurred itinerary */}
      <div className="hidden sm:block w-1/2 bg-gray-50 p-4 opacity-40 blur-[1px]">
        <div className="bg-gradient-to-r from-coral-500 to-orange-500 rounded-xl px-4 py-2 mb-3">
          <div className="text-white text-xs font-bold">{pt ? "Dia 1 — Montmartre" : "Day 1 — Montmartre"}</div>
        </div>
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-gray-200" />
            <div className="flex-1"><div className="h-2.5 bg-gray-200 rounded w-3/4 mb-1" /><div className="h-2 bg-gray-200 rounded w-1/2" /></div>
          </div>
        ))}
      </div>

      {/* Right — detail panel */}
      <div className="flex-1 sm:w-1/2 overflow-hidden flex flex-col">
        {/* Photo */}
        <div className="relative h-32 flex-shrink-0">
          <img src="https://images.unsplash.com/photo-1568684333877-4d39f2b589b8?w=500&h=250&fit=crop&q=80" alt="" className="w-full h-full object-cover" loading="lazy" />
          <div className="absolute bottom-2 right-2 bg-black/60 text-white text-[8px] font-bold px-2 py-0.5 rounded-lg backdrop-blur-sm">📷 Google</div>
        </div>

        <div className="flex-1 p-4 space-y-2.5 overflow-hidden">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-gray-900">⛪ Sacré-Cœur</h3>
              <span className="bg-orange-100 text-orange-600 text-[7px] font-bold px-1.5 py-0.5 rounded-full">🌅 {pt ? "Pôr do sol" : "Sunset"}</span>
            </div>
            <div className="flex items-center gap-2 mt-1 text-[10px]">
              <span className="text-amber-500 font-bold">★ 4.7</span>
              <span className="text-gray-400">(245,891)</span>
              <span className="text-gray-400">•</span>
              <span className="text-gray-500">⏱ ~1h</span>
              <span className="text-gray-400">•</span>
              <span className="text-emerald-600 font-semibold">{pt ? "Grátis" : "Free"}</span>
            </div>
          </div>

          {/* Tip */}
          <div className="bg-emerald-50 rounded-xl p-2.5 border-l-3 border-emerald-400" style={{ opacity: p > 0.2 ? 1 : 0, transition: "opacity 0.3s" }}>
            <div className="text-[9px] text-emerald-600 font-bold">💡 {pt ? "Dica da Voyara" : "Voyara tip"}</div>
            <p className="text-[10px] text-emerald-800 leading-relaxed mt-0.5">
              {pt ? "Suba pela escadaria (não pelo funicular). A basílica é grátis, só o domo custa €7." : "Climb the stairs (not the funicular). Basilica is free, dome costs €7."}
            </p>
          </div>

          <div className="bg-gray-50 rounded-xl p-2.5 flex items-center justify-between" style={{ opacity: p > 0.35 ? 1 : 0, transition: "opacity 0.3s" }}>
            <div>
              <span className="text-[9px] text-gray-500 font-semibold">{pt ? "Horário" : "Hours"}</span>
              <div className="text-[10px] text-gray-700 font-medium">06:00 - 22:30</div>
            </div>
            <span className="text-[9px] text-emerald-600 font-bold bg-emerald-50 px-2 py-0.5 rounded-full">{pt ? "Aberto" : "Open"}</span>
          </div>

          <div className="text-[10px] text-gray-500" style={{ opacity: p > 0.45 ? 1 : 0, transition: "opacity 0.3s" }}>📍 35 Rue du Chevalier de la Barre, 75018</div>

          <div className="flex gap-2" style={{ opacity: p > 0.55 ? 1 : 0, transition: "opacity 0.3s" }}>
            <span className="bg-blue-500 text-white text-[9px] font-bold px-3 py-1.5 rounded-lg">🗺️ Google Maps</span>
            <span className="bg-gray-100 text-gray-600 text-[9px] font-bold px-3 py-1.5 rounded-lg">🌐 Website</span>
          </div>

          {/* Personal note */}
          <div className="bg-amber-50 rounded-xl p-2 border border-amber-200" style={{ opacity: p > 0.7 ? 1 : 0, transition: "opacity 0.3s" }}>
            <div className="text-[8px] text-amber-600 font-bold">✏️ {pt ? "Sua nota" : "Your note"}</div>
            <p className="text-[9px] text-amber-800 italic">{pt ? "Levar tripé pra foto do pôr do sol!" : "Bring tripod for sunset photo!"}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════
   Scene: EXTRAS — Flights, hotel, notes
══════════════════════════════════════════ */
function ExtrasScene({ p, pt }) {
  return (
    <div className="h-full bg-gradient-to-b from-blue-50 to-white flex items-center justify-center px-6">
      <div className="w-full max-w-2xl flex gap-4">
        {/* Flight */}
        <div className="flex-1 bg-white rounded-2xl shadow-xl overflow-hidden" style={{ opacity: p > 0.05 ? 1 : 0, transform: `translateY(${p > 0.05 ? 0 : 15}px)`, transition: "all 0.4s" }}>
          <div className="bg-gradient-to-r from-blue-500 to-blue-600 px-4 py-2 flex items-center gap-2">
            <span className="text-white text-sm">✈️</span>
            <span className="text-white text-xs font-bold">{pt ? "Voo" : "Flight"}</span>
          </div>
          <div className="p-3">
            <div className="flex items-center gap-3">
              <div className="text-center">
                <div className="text-lg font-black text-gray-900">GRU</div>
                <div className="text-[8px] text-gray-400">23:45</div>
              </div>
              <div className="flex-1 text-center relative">
                <div className="h-px border-t-2 border-dashed border-gray-300 absolute top-1/2 left-0 right-0" />
                <span className="relative bg-white px-2 text-[9px] text-gray-500">✈ LA8045</span>
              </div>
              <div className="text-center">
                <div className="text-lg font-black text-gray-900">CDG</div>
                <div className="text-[8px] text-gray-400">14:10</div>
              </div>
            </div>
            <div className="text-[8px] text-gray-400 text-center mt-1">14 Jul • 24A, 24B</div>
          </div>
        </div>

        {/* Hotel + Notes stacked */}
        <div className="flex-1 space-y-3">
          <div className="bg-white rounded-2xl shadow-xl p-3" style={{ opacity: p > 0.25 ? 1 : 0, transform: `translateY(${p > 0.25 ? 0 : 15}px)`, transition: "all 0.4s" }}>
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-xl bg-violet-100 flex items-center justify-center text-lg">🏨</div>
              <div>
                <div className="text-xs font-bold text-gray-900">Hôtel Le Marais</div>
                <div className="text-[9px] text-gray-500">14-20 Jul • 6 {pt ? "noites" : "nights"}</div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-xl p-3" style={{ opacity: p > 0.45 ? 1 : 0, transform: `translateY(${p > 0.45 ? 0 : 15}px)`, transition: "all 0.4s" }}>
            <div className="text-[10px] font-bold text-gray-900 mb-2">📝 {pt ? "Notas" : "Notes"}</div>
            <div className="space-y-1">
              {[
                { icon: "🍽️", text: pt ? "Reserva Le Jules Verne — 19h30" : "Le Jules Verne — 7:30pm" },
                { icon: "🎫", text: pt ? "Ingresso Louvre — comprado!" : "Louvre ticket — bought!" },
                { icon: "📱", text: pt ? "eSIM: Airalo Europa" : "eSIM: Airalo Europe" },
              ].map((n, i) => (
                <div key={i} className="flex items-center gap-1.5 bg-violet-50 rounded-lg px-2 py-1" style={{ opacity: p > 0.5 + i * 0.1 ? 1 : 0, transition: "opacity 0.3s" }}>
                  <span className="text-[10px]">{n.icon}</span>
                  <span className="text-[9px] text-violet-800">{n.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════
   Scene: SHARE — PDF + sharing options
══════════════════════════════════════════ */
function ShareScene({ p, pt }) {
  return (
    <div className="h-full bg-gradient-to-b from-violet-50 to-white flex items-center justify-center px-6">
      <div className="w-full max-w-lg flex gap-5">
        {/* PDF preview */}
        <div className="flex-1 bg-white rounded-2xl shadow-2xl overflow-hidden" style={{ opacity: p > 0.05 ? 1 : 0, transition: "opacity 0.3s" }}>
          <div className="bg-gradient-to-r from-coral-500 to-violet-500 px-4 py-4 text-center">
            <div className="text-white text-sm font-black">{pt ? "Paris em 5 Dias" : "Paris in 5 Days"}</div>
            <div className="flex justify-center gap-5 mt-2">
              <div className="text-center"><div className="text-white text-base font-bold">5</div><div className="text-white/50 text-[7px]">{pt ? "DIAS" : "DAYS"}</div></div>
              <div className="text-center"><div className="text-white text-base font-bold">32</div><div className="text-white/50 text-[7px]">{pt ? "LUGARES" : "PLACES"}</div></div>
            </div>
          </div>
          <div className="p-3 space-y-1.5">
            {["☕ Café des Deux Moulins", "⛪ Sacré-Cœur", "🎨 Place du Tertre"].map((n, i) => (
              <div key={i} className="flex items-center gap-2 text-[10px] text-gray-600 border-b border-gray-50 pb-1" style={{ opacity: p > 0.2 + i * 0.1 ? 1 : 0, transition: "opacity 0.3s" }}>
                <span className="font-semibold text-gray-800">{n}</span>
              </div>
            ))}
            <div className="text-[8px] text-gray-400 text-center">+ 29 {pt ? "lugares..." : "places..."}</div>
          </div>
        </div>

        {/* Share buttons */}
        <div className="flex flex-col gap-2.5 justify-center">
          {[
            { icon: "💬", label: "WhatsApp", color: "bg-emerald-500" },
            { icon: "📧", label: "Email", color: "bg-blue-500" },
            { icon: "🔗", label: pt ? "Copiar" : "Copy", color: "bg-gray-800" },
            { icon: "📄", label: "PDF", color: "bg-coral-500" },
          ].map((s, i) => (
            <div key={s.label} className={`${s.color} text-white rounded-xl px-5 py-3 flex items-center gap-2 shadow-sm`}
              style={{ opacity: p > 0.15 + i * 0.15 ? 1 : 0, transform: `translateX(${p > 0.15 + i * 0.15 ? 0 : 15}px)`, transition: "all 0.4s" }}>
              <span className="text-lg">{s.icon}</span>
              <span className="text-xs font-bold">{s.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════
   Scene: CLOSING — Emotional CTA
══════════════════════════════════════════ */
function ClosingScene({ p, pt }) {
  return (
    <div className="h-full bg-gradient-to-br from-coral-500 via-coral-600 to-violet-600 flex flex-col items-center justify-center relative overflow-hidden">
      <div className="absolute -top-16 -right-16 w-48 h-48 rounded-full bg-white/10" />
      <div className="absolute -bottom-12 -left-12 w-40 h-40 rounded-full bg-white/10" />

      <div className="relative z-10 text-center px-6">
        <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center mx-auto mb-4"
          style={{ transform: `scale(${p > 0.05 ? 1 : 0.5})`, transition: "transform 0.5s cubic-bezier(0.34,1.56,0.64,1)" }}>
          <div className="w-11 h-11 rounded-full bg-white flex items-center justify-center shadow-xl">
            <span className="text-coral-500 text-xl font-black">V</span>
          </div>
        </div>

        <h2 className="text-white text-2xl font-extrabold mb-2" style={{ opacity: p > 0.15 ? 1 : 0, transition: "opacity 0.3s" }}>
          {pt ? "Sua viagem te espera" : "Your trip is waiting"}
        </h2>
        <p className="text-white/70 text-sm mb-5" style={{ opacity: p > 0.25 ? 1 : 0, transition: "opacity 0.3s" }}>
          {pt ? "Cole um link. A mágica acontece em 30 segundos." : "Paste a link. Magic happens in 30 seconds."}
        </p>

        <div className="bg-white text-coral-600 text-sm font-bold px-8 py-3 rounded-full shadow-xl inline-block"
          style={{ opacity: p > 0.4 ? 1 : 0, transform: `translateY(${p > 0.4 ? 0 : 8}px) scale(${p > 0.6 ? 1.05 : 1})`, transition: "all 0.3s" }}>
          {pt ? "Começar agora →" : "Start now →"}
        </div>
      </div>
    </div>
  );
}

/* ── Helpers ── */
function TypeWriter({ text, progress }) {
  const chars = Math.floor(progress * text.length);
  return (
    <span>
      {text.slice(0, Math.min(chars, text.length))}
      {progress < 1 && <span className="text-coral-500 animate-pulse">|</span>}
    </span>
  );
}
