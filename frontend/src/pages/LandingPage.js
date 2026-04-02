import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { useLanguage } from "../i18n/LanguageContext";
import { useAuth } from "../auth/AuthContext";
import Logo from "../components/layout/Logo";
import HeroDemo from "../components/landing/HeroDemo";
import ShowcaseMap from "../components/landing/ShowcaseMap";
import LinkAnalyzer from "../components/links/LinkAnalyzer";
import AnalyzeResultModal from "../components/links/AnalyzeResultModal";
import DestinationPreview from "../components/landing/DestinationPreview";

/* ── Destination showcase ── */
const DESTINATIONS = [
  { city: "Paris", country: "France", img: "https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=600&h=400&fit=crop&q=80", days: 5 },
  { city: "Tokyo", country: "Japan", img: "https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=600&h=400&fit=crop&q=80", days: 7 },
  { city: "Rome", country: "Italy", img: "https://images.unsplash.com/photo-1552832230-c0197dd311b5?w=600&h=400&fit=crop&q=80", days: 4 },
  { city: "Barcelona", country: "Spain", img: "https://images.unsplash.com/photo-1539037116277-4db20889f2d4?w=600&h=400&fit=crop&q=80", days: 4 },
  { city: "Bali", country: "Indonesia", img: "https://images.unsplash.com/photo-1537996194471-e657df975ab4?w=600&h=400&fit=crop&q=80", days: 6 },
  { city: "New York", country: "USA", img: "https://images.unsplash.com/photo-1496442226666-8d4d0e62e6e9?w=600&h=400&fit=crop&q=80", days: 5 },
];

/* ── Social proof reviews ── */
const REVIEWS = [
  { name: "Ana Costa", role: "Travel Blogger", avatar: "https://i.pravatar.cc/80?img=5", stars: 5, text: { en: "I used to spend DAYS planning a single trip. Now I paste a TikTok link and have a complete itinerary with maps in 30 seconds. This is insane.", pt: "Eu gastava DIAS planejando uma viagem. Agora colo um link do TikTok e tenho um roteiro completo com mapa em 30 segundos. Isso é absurdo." }},
  { name: "Pedro Oliveira", avatar: "https://i.pravatar.cc/80?img=11", stars: 5, text: { en: "The AI understood exactly what I wanted. It grouped nearby places together, put viewpoints at sunset, suggested hidden gems. It thinks like a real traveler.", pt: "A IA entendeu exatamente o que eu queria. Agrupou lugares próximos, colocou mirantes no pôr do sol, sugeriu lugares escondidos. Pensa como um viajante de verdade." }},
  { name: "Luana Mendes", avatar: "https://i.pravatar.cc/80?img=23", stars: 5, text: { en: "I watched a travel vlog about Lisbon, pasted the link, and 30 seconds later had a better itinerary than I could plan in a week. Game changer.", pt: "Assisti um vlog de viagem sobre Lisboa, colei o link, e 30 segundos depois tinha um roteiro melhor do que eu planejaria em uma semana. Mudou o jogo." }},
  { name: "Rafael Santos", avatar: "https://i.pravatar.cc/80?img=53", stars: 5, text: { en: "Finally no more zigzagging across the city! Every day makes geographic sense. Saved me hours of walking and tons of stress.", pt: "Finalmente chega de ziguezaguear pela cidade! Todo dia faz sentido geográfico. Me economizou horas de caminhada e muita dor de cabeça." }},
  { name: "Camila Ferreira", role: "Digital Nomad", avatar: "https://i.pravatar.cc/80?img=45", stars: 5, text: { en: "The color-coded map view is brilliant. I can see my entire week at a glance. This replaced 3 different apps I was using.", pt: "O mapa com cores por dia é brilhante. Consigo ver a semana inteira de relance. Substituiu 3 apps diferentes que eu usava." }},
  { name: "Marcos Lima", avatar: "https://i.pravatar.cc/80?img=68", stars: 5, text: { en: "My wife and I planned our honeymoon in 10 minutes. TEN MINUTES. It would have taken us weeks arguing over spreadsheets.", pt: "Eu e minha esposa planejamos nossa lua de mel em 10 minutos. DEZ MINUTOS. Levaríamos semanas discutindo em planilhas." }},
];

/* ── Before/After comparison ── */
const BEFORE_ITEMS_EN = [
  "12 browser tabs open at once",
  "Copy-pasting addresses into spreadsheets",
  "Zigzagging across town because nothing is grouped",
  "Missing the best viewpoint because you didn't know the sunset time",
  "Spending 3 days planning a 5-day trip",
];
const BEFORE_ITEMS_PT = [
  "12 abas do navegador abertas ao mesmo tempo",
  "Copiando e colando endereços em planilhas",
  "Ziguezagueando pela cidade porque nada está agrupado",
  "Perdendo o melhor mirante porque não sabia o horário do pôr do sol",
  "Gastando 3 dias planejando uma viagem de 5 dias",
];
const AFTER_ITEMS_EN = [
  "One link. One click. Done.",
  "All places validated on Google Maps with photos and ratings",
  "Days organized by proximity — walk more, waste less",
  "Sunset viewpoints, morning markets, night walks — all timed perfectly",
  "From link to complete itinerary in 30 seconds",
];
const AFTER_ITEMS_PT = [
  "Um link. Um clique. Pronto.",
  "Todos os lugares validados no Google Maps com fotos e avaliações",
  "Dias organizados por proximidade — caminhe mais, desperdice menos",
  "Mirantes no pôr do sol, mercados de manhã, passeios noturnos — tudo no timing certo",
  "De link a roteiro completo em 30 segundos",
];

/* ── Animated counter hook ── */
function useCountUp(end, duration = 2000, startOnView = true) {
  const [count, setCount] = useState(0);
  const ref = useRef(null);
  const started = useRef(false);

  useEffect(() => {
    if (!startOnView) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !started.current) {
          started.current = true;
          const startTime = Date.now();
          const tick = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            setCount(Math.round(eased * end));
            if (progress < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }
      },
      { threshold: 0.3 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [end, duration, startOnView]);

  return [count, ref];
}

/* ── Mini map for hero section — Real Google Maps + animated pins ── */
function HeroMiniMap() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const timings = [600, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 800, 800, 1500];
    let timeout;
    let current = 0;
    const advance = () => {
      current++;
      if (current >= timings.length) current = 0;
      setStep(current);
      timeout = setTimeout(advance, timings[current]);
    };
    timeout = setTimeout(advance, timings[0]);
    return () => clearTimeout(timeout);
  }, []);

  const visiblePins = Math.min(18, step);
  const showHotel = step >= 3;
  const showRoutes = step >= 6;
  const activeDay = step >= 13 ? (step >= 14 ? 2 : 1) : null;

  return (
    <div className="rounded-2xl overflow-hidden shadow-2xl border border-gray-200 bg-white h-full flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-3 py-2 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
          </svg>
          <span className="text-[11px] font-bold text-gray-700">5-Day Paris Trip</span>
        </div>
        <span className="text-[9px] text-gray-400 font-medium">18 spots</span>
      </div>

      {/* Map area — Real Google Maps */}
      <div className="flex-1 relative overflow-hidden" style={{ minHeight: 320 }}>
        <ShowcaseMap
          className="w-full h-full"
          visiblePins={visiblePins}
          showRoutes={showRoutes}
          showHotel={showHotel}
          showHotelInfo={showHotel && step >= 10}
          activeDay={activeDay}
          zoom={13}
        >
          {/* Distance badges */}
          {step >= 8 && (
            <div className="absolute top-2 left-2 flex flex-col gap-1 z-30 pointer-events-none">
              <span className="bg-orange-500 text-white text-[7px] font-bold px-2 py-0.5 rounded-full shadow-lg">Day 1 • 9.9 km</span>
              {step >= 10 && <span className="bg-blue-500 text-white text-[7px] font-bold px-2 py-0.5 rounded-full shadow-lg">Day 2 • 4.9 km</span>}
              {step >= 12 && <span className="bg-emerald-500 text-white text-[7px] font-bold px-2 py-0.5 rounded-full shadow-lg">Day 3 • 6.0 km</span>}
            </div>
          )}
        </ShowcaseMap>
      </div>

      {/* Legend footer */}
      <div className="bg-white border-t border-gray-200 px-3 py-2 flex items-center gap-3 flex-shrink-0">
        {[
          { color: "#F97316", label: "Day 1 • 9.9km" },
          { color: "#3B82F6", label: "Day 2 • 4.9km" },
          { color: "#22C55E", label: "Day 3 • 6km" },
        ].map((d) => (
          <div key={d.label} className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
            <span className="text-[8px] text-gray-500 font-semibold">{d.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function LandingPage() {
  const { t, toggle, lang } = useLanguage();
  const { user } = useAuth();
  const pt = lang === "pt-BR";
  const [analyzeResult, setAnalyzeResult] = useState(null);
  const [previewDest, setPreviewDest] = useState(null);
  const ctaLink = user ? "/dashboard?new=1" : "/login";

  const [tripsCount, tripsRef] = useCountUp(2847);
  const [placesCount, placesRef] = useCountUp(18420);
  const [timeCount, timeRef] = useCountUp(30);

  return (
    <div className="min-h-screen bg-white">
      {/* ═══════════════════════════════════════════
          NAVIGATION
      ═══════════════════════════════════════════ */}
      <nav className="fixed top-0 left-0 right-0 bg-white/90 backdrop-blur-md z-50 border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2.5">
              <Logo size={30} />
              <span className="text-xl font-bold text-gray-900 tracking-tight">Voyara</span>
            </div>
            <div className="hidden sm:flex items-center gap-1">
              <Link to="/" className="px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 text-gray-900">
                {t("nav.home")}
              </Link>
              <Link to="/dashboard" className="px-3 py-1.5 rounded-lg text-sm font-medium text-gray-500 hover:text-gray-900 hover:bg-gray-50 transition-colors">
                {t("nav.myTrips")}
              </Link>
              <Link to="/pricing" className="px-3 py-1.5 rounded-lg text-sm font-medium text-gray-500 hover:text-gray-900 hover:bg-gray-50 transition-colors">
                {t("nav.pricing")}
              </Link>
              <Link to="/features" className="px-3 py-1.5 rounded-lg text-sm font-medium text-gray-500 hover:text-gray-900 hover:bg-gray-50 transition-colors">
                {pt ? "Como funciona" : "How it works"}
              </Link>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={toggle} className="text-sm text-gray-500 hover:text-gray-900 transition-colors">
              {pt ? "EN" : "PT"}
            </button>
            {user ? (
              <Link to="/dashboard" className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-colors">
                <div className="w-7 h-7 rounded-full bg-coral-500 flex items-center justify-center text-white text-xs font-bold">
                  {user.name?.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2)}
                </div>
                <span className="hidden sm:block text-sm text-gray-700 font-medium">{user.name}</span>
              </Link>
            ) : (
              <>
                <Link to="/login" className="text-sm text-gray-600 hover:text-gray-900 font-medium transition-colors hidden sm:block">
                  {t("auth.login")}
                </Link>
                <Link to="/login" className="bg-coral-500 hover:bg-coral-600 text-white text-sm font-semibold px-5 py-2 rounded-full transition-colors shadow-sm">
                  {t("landing.startPlanning")}
                </Link>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* ═══════════════════════════════════════════
          HERO — Pain → Dream → Bridge (BAB)
      ═══════════════════════════════════════════ */}
      <section className="pt-28 pb-20 px-6 relative overflow-hidden">
        {/* Subtle background gradient */}
        <div className="absolute inset-0 bg-gradient-to-b from-coral-50/40 via-white to-white pointer-events-none" />

        <div className="max-w-6xl mx-auto relative">
          <div className="text-center max-w-3xl mx-auto mb-14">
            {/* Micro-label */}
            <div className="inline-flex items-center gap-2 bg-coral-50 text-coral-600 text-xs font-semibold px-4 py-1.5 rounded-full mb-6 border border-coral-100">
              <span className="w-2 h-2 rounded-full bg-coral-500 animate-pulse" />
              {pt ? "Seu primeiro roteiro é grátis" : "Your first itinerary is free"}
            </div>

            {/* Headline — Emotional hook */}
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-gray-900 leading-[1.1] tracking-tight mb-6">
              {t("landing.headline")}
            </h1>

            {/* Subheadline — Agitate the pain, show the dream */}
            <p className="text-lg sm:text-xl text-gray-500 leading-relaxed mb-10 max-w-2xl mx-auto">
              {t("landing.subheadline")}
            </p>

            {/* CTA — LinkAnalyzer */}
            <div className="max-w-xl mx-auto">
              <LinkAnalyzer onResult={setAnalyzeResult} />
              <p className="mt-3 text-sm text-gray-400">
                {pt
                  ? "Instagram, YouTube, TikTok, blog — cole qualquer link de viagem"
                  : "Instagram, YouTube, TikTok, blog — paste any travel link"}
              </p>
            </div>

            <div className="flex items-center justify-center gap-6 mt-5">
              <Link to={ctaLink} className="text-gray-400 hover:text-gray-600 font-medium text-sm transition-colors">
                {pt ? "ou crie manualmente" : "or create manually"} →
              </Link>
              <Link to="/features" className="text-violet-500 hover:text-violet-600 font-semibold text-sm transition-colors">
                {pt ? "Ver como funciona" : "See how it works"} →
              </Link>
              <Link to="/pricing" className="text-coral-500 hover:text-coral-600 font-semibold text-sm transition-colors">
                {pt ? "Ver planos" : "View plans"} →
              </Link>
            </div>
          </div>

          {/* Hero Demo + Mini Map */}
          <div className="flex gap-4 px-2">
            {/* Main walkthrough */}
            <div className="flex-1 min-w-0">
              <HeroDemo />
            </div>
            {/* Mini animated map */}
            <div className="hidden lg:block w-72 xl:w-80 flex-shrink-0">
              <HeroMiniMap />
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════
          SOCIAL PROOF BAR — Immediate trust
      ═══════════════════════════════════════════ */}
      <section className="py-10 border-y border-gray-100 bg-gradient-to-r from-gray-50/80 via-white to-gray-50/80">
        <div className="max-w-5xl mx-auto px-6 grid grid-cols-1 sm:grid-cols-3 gap-8 text-center">
          <div ref={tripsRef} className="space-y-1">
            <div className="text-4xl font-black text-coral-500 tracking-tight tabular-nums">
              {tripsCount.toLocaleString()}+
            </div>
            <div className="text-sm font-semibold text-gray-900">
              {pt ? "Roteiros criados" : "Itineraries created"}
            </div>
            <div className="text-xs text-gray-400">
              {pt ? "por viajantes como você" : "by travelers like you"}
            </div>
          </div>
          <div ref={placesRef} className="space-y-1">
            <div className="text-4xl font-black text-violet-500 tracking-tight tabular-nums">
              {placesCount.toLocaleString()}+
            </div>
            <div className="text-sm font-semibold text-gray-900">
              {pt ? "Lugares descobertos" : "Places discovered"}
            </div>
            <div className="text-xs text-gray-400">
              {pt ? "validados no Google Maps" : "validated on Google Maps"}
            </div>
          </div>
          <div ref={timeRef} className="space-y-1">
            <div className="text-4xl font-black text-emerald-500 tracking-tight tabular-nums">
              {timeCount}s
            </div>
            <div className="text-sm font-semibold text-gray-900">
              {pt ? "De link a roteiro completo" : "From link to full itinerary"}
            </div>
            <div className="text-xs text-gray-400">
              {pt ? "a IA faz em segundos o que leva dias" : "AI does in seconds what takes days"}
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════
          BEFORE / AFTER — Transformation
      ═══════════════════════════════════════════ */}
      <section className="py-20 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">
              {pt
                ? "Planejar viagem não deveria ser um trabalho"
                : "Planning a trip shouldn't feel like a job"}
            </h2>
            <p className="text-gray-500 text-lg max-w-2xl mx-auto">
              {pt
                ? "Você conhece essa sensação. Horas pesquisando, abas infinitas, planilhas... e no final ainda tem medo de estar perdendo o melhor."
                : "You know the feeling. Hours researching, endless tabs, spreadsheets... and still worried you're missing the best parts."}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* BEFORE */}
            <div className="bg-gray-50 rounded-2xl p-8 border border-gray-200 relative">
              <div className="absolute -top-3 left-6 bg-red-100 text-red-600 text-xs font-bold px-3 py-1 rounded-full">
                {pt ? "ANTES" : "BEFORE"}
              </div>
              <div className="space-y-4 mt-2">
                {(pt ? BEFORE_ITEMS_PT : BEFORE_ITEMS_EN).map((item, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <span className="text-red-400 mt-0.5 flex-shrink-0">✗</span>
                    <p className="text-gray-600 text-sm leading-relaxed">{item}</p>
                  </div>
                ))}
              </div>
              <div className="mt-6 text-center">
                <span className="text-3xl">😩</span>
              </div>
            </div>

            {/* AFTER */}
            <div className="bg-gradient-to-br from-emerald-50 to-green-50 rounded-2xl p-8 border border-emerald-200 relative shadow-lg shadow-emerald-100/50">
              <div className="absolute -top-3 left-6 bg-emerald-100 text-emerald-700 text-xs font-bold px-3 py-1 rounded-full">
                {pt ? "COM VOYARA" : "WITH VOYARA"}
              </div>
              <div className="space-y-4 mt-2">
                {(pt ? AFTER_ITEMS_PT : AFTER_ITEMS_EN).map((item, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <span className="text-emerald-500 mt-0.5 flex-shrink-0">✓</span>
                    <p className="text-gray-700 text-sm leading-relaxed font-medium">{item}</p>
                  </div>
                ))}
              </div>
              <div className="mt-6 text-center">
                <span className="text-3xl">🤩</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════
          HOW IT WORKS — 3-step simplicity
      ═══════════════════════════════════════════ */}
      <section className="py-20 px-6 bg-gray-50">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">
              {pt ? "Tão simples que parece mágica" : "So simple it feels like magic"}
            </h2>
            <p className="text-gray-500 text-lg max-w-xl mx-auto">
              {pt
                ? "3 passos. Menos de um minuto. Roteiro profissional."
                : "3 steps. Under one minute. Professional itinerary."}
            </p>
          </div>

          <div className="space-y-0">
            {[
              { step: "01", key: "step1", color: "bg-coral-500", icon: "🔗", gradient: "from-coral-500 to-orange-500" },
              { step: "02", key: "step2", color: "bg-violet-500", icon: "🤖", gradient: "from-violet-500 to-purple-500" },
              { step: "03", key: "step3", color: "bg-emerald-500", icon: "✨", gradient: "from-emerald-500 to-green-500" },
            ].map(({ step, key, gradient, icon }, idx) => (
              <div key={key} className="flex items-start gap-6 relative group">
                {idx < 2 && <div className="absolute left-5 top-12 w-px h-16 bg-gray-200" />}
                <div className={`bg-gradient-to-br ${gradient} text-white text-sm font-bold w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 shadow-lg relative z-10 group-hover:scale-110 transition-transform`}>
                  {step}
                </div>
                <div className="pb-12">
                  <h3 className="text-xl font-bold text-gray-900 mb-1 flex items-center gap-2">
                    {t(`landing.howItWorks.${key}.title`)}
                    <span className="text-lg">{icon}</span>
                  </h3>
                  <p className="text-gray-500 leading-relaxed">
                    {t(`landing.howItWorks.${key}.desc`)}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* Inline CTA */}
          <div className="text-center mt-4 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              to={ctaLink}
              className="inline-flex items-center gap-2 bg-coral-500 hover:bg-coral-600 text-white font-semibold px-8 py-3.5 rounded-full transition-all hover:shadow-lg hover:shadow-coral-200 text-base"
            >
              {t("landing.ctaButton")}
            </Link>
            <Link
              to="/features"
              className="inline-flex items-center gap-2 bg-white border-2 border-gray-200 hover:border-violet-300 text-gray-700 hover:text-violet-600 font-semibold px-8 py-3 rounded-full transition-all text-base"
            >
              {pt ? "Ver todas as funcionalidades" : "See all features"} →
            </Link>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════
          FEATURES — Benefit-framed, not feature-listing
      ═══════════════════════════════════════════ */}
      <section id="features" className="py-20 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">
              {t("landing.featuresTitle")}
            </h2>
            <p className="text-gray-500 text-lg max-w-2xl mx-auto">
              {t("landing.featuresSubtitle")}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { icon: "🔗", key: "linkImport", color: "from-violet-50 to-purple-50", border: "hover:border-violet-200", accent: "bg-violet-500" },
              { icon: "🤖", key: "aiItinerary", color: "from-coral-50 to-orange-50", border: "hover:border-coral-200", accent: "bg-coral-500" },
              { icon: "🗺️", key: "mapView", color: "from-emerald-50 to-green-50", border: "hover:border-emerald-200", accent: "bg-emerald-500" },
              { icon: "⏰", key: "smartTiming", color: "from-amber-50 to-yellow-50", border: "hover:border-amber-200", accent: "bg-amber-500" },
              { icon: "✈️", key: "flightsHotels", color: "from-blue-50 to-sky-50", border: "hover:border-blue-200", accent: "bg-blue-500" },
              { icon: "💡", key: "smartSuggestions", color: "from-pink-50 to-rose-50", border: "hover:border-pink-200", accent: "bg-pink-500" },
            ].map(({ icon, key, color, border }) => (
              <div key={key} className={`bg-gradient-to-br ${color} rounded-2xl p-6 border border-gray-100 ${border} hover:shadow-lg transition-all group cursor-default hover:-translate-y-1`}>
                <div className="w-12 h-12 rounded-xl bg-white shadow-sm flex items-center justify-center text-2xl mb-4 group-hover:scale-110 transition-transform">{icon}</div>
                <h3 className="text-lg font-bold text-gray-900 mb-2">
                  {t(`landing.features.${key}.title`)}
                </h3>
                <p className="text-gray-500 text-sm leading-relaxed">
                  {t(`landing.features.${key}.desc`)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════
          DESTINATIONS — Visual desire trigger
      ═══════════════════════════════════════════ */}
      <section className="py-20 px-6 bg-gray-50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">
              {pt ? "Onde você quer acordar amanhã?" : "Where do you want to wake up tomorrow?"}
            </h2>
            <p className="text-gray-500 text-lg max-w-2xl mx-auto">
              {pt
                ? "Escolha um destino e tenha um roteiro profissional em 30 segundos. Sério."
                : "Pick a destination and get a professional itinerary in 30 seconds. Seriously."}
            </p>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
            {DESTINATIONS.map((dest) => (
              <button
                key={dest.city}
                onClick={() => setPreviewDest(dest.city)}
                className="group relative rounded-2xl overflow-hidden aspect-[4/3] shadow-md hover:shadow-xl transition-all hover:-translate-y-1 text-left"
              >
                <img src={dest.img} alt={dest.city} className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                <div className="absolute bottom-0 left-0 right-0 p-4 sm:p-5">
                  <h3 className="text-white text-xl sm:text-2xl font-bold mb-0.5">{dest.city}</h3>
                  <p className="text-white/60 text-xs sm:text-sm">{dest.country}</p>
                </div>
                <div className="absolute top-3 right-3 bg-white/90 backdrop-blur-sm text-gray-900 text-xs font-bold px-2.5 py-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                  <span>👀</span> {pt ? "Ver preview" : "See preview"}
                </div>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════
          TESTIMONIALS — Social proof with emotion
      ═══════════════════════════════════════════ */}
      <section className="py-20 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">
              {pt ? "Não acredite em nós. Acredite neles." : "Don't take our word for it."}
            </h2>
            <p className="text-gray-500 text-lg max-w-xl mx-auto">
              {pt
                ? "Viajantes reais. Roteiros reais. Resultados reais."
                : "Real travelers. Real itineraries. Real results."}
            </p>
          </div>

          <div className="columns-1 sm:columns-2 lg:columns-3 gap-5 space-y-5">
            {REVIEWS.map((review, i) => (
              <div key={i} className="break-inside-avoid bg-white rounded-2xl p-6 border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex gap-0.5 mb-3">
                  {Array.from({ length: review.stars }).map((_, j) => (
                    <span key={j} className="text-amber-400 text-sm">★</span>
                  ))}
                </div>
                <p className="text-sm text-gray-700 leading-relaxed mb-4">
                  "{pt ? review.text.pt : review.text.en}"
                </p>
                <div className="flex items-center gap-3">
                  <img src={review.avatar} alt="" className="w-9 h-9 rounded-full object-cover" loading="lazy" />
                  <div>
                    <div className="text-sm font-semibold text-gray-900">{review.name}</div>
                    {review.role && <div className="text-xs text-gray-400">{review.role}</div>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════
          OBJECTION CRUSHER — FAQ-style trust builder
      ═══════════════════════════════════════════ */}
      <section className="py-20 px-6 bg-gray-50">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">
              {pt ? "Ainda tem dúvidas?" : "Still have questions?"}
            </h2>
          </div>

          <div className="space-y-4">
            {[
              {
                q: pt ? "Posso testar sem pagar?" : "Can I try it for free?",
                a: pt
                  ? "Sim. Seu primeiro roteiro é por nossa conta — completo, com mapa e lugares validados. Sem cartão, sem compromisso. Você só paga se quiser mais."
                  : "Yes. Your first itinerary is on us — complete, with map and validated places. No card, no commitment. You only pay if you want more."
              },
              {
                q: pt ? "Os lugares são reais e validados?" : "Are the places real and validated?",
                a: pt
                  ? "Cada lugar é verificado no Google Maps com fotos, avaliações, horários e endereço exato. Nada inventado."
                  : "Every place is verified on Google Maps with photos, ratings, hours and exact address. Nothing made up."
              },
              {
                q: pt ? "Funciona com qualquer link?" : "Does it work with any link?",
                a: pt
                  ? "Instagram, YouTube, TikTok, blogs de viagem, artigos — se tem um lugar mencionado, a IA encontra."
                  : "Instagram, YouTube, TikTok, travel blogs, articles — if a place is mentioned, the AI finds it."
              },
              {
                q: pt ? "Posso editar o roteiro depois?" : "Can I edit the itinerary after?",
                a: pt
                  ? "Claro! Arraste para reordenar, adicione ou remova lugares, peça para a IA refinar dias específicos. O roteiro é seu."
                  : "Of course! Drag to reorder, add or remove places, ask AI to refine specific days. The itinerary is yours."
              },
            ].map(({ q, a }, i) => (
              <details key={i} className="group bg-white rounded-xl border border-gray-200 overflow-hidden">
                <summary className="flex items-center justify-between px-6 py-4 cursor-pointer hover:bg-gray-50 transition-colors">
                  <span className="text-base font-semibold text-gray-900">{q}</span>
                  <svg className="w-5 h-5 text-gray-400 group-open:rotate-180 transition-transform flex-shrink-0 ml-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </summary>
                <div className="px-6 pb-4">
                  <p className="text-sm text-gray-600 leading-relaxed">{a}</p>
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════
          FINAL CTA — Emotional close + urgency
      ═══════════════════════════════════════════ */}
      <section className="py-20 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="bg-gradient-to-br from-coral-500 via-coral-600 to-orange-600 rounded-3xl p-10 sm:p-14 text-center relative overflow-hidden">
            {/* Decorative */}
            <div className="absolute -top-16 -right-16 w-48 h-48 rounded-full bg-white/10" />
            <div className="absolute -bottom-12 -left-12 w-40 h-40 rounded-full bg-white/10" />
            <div className="absolute top-1/2 left-1/4 w-24 h-24 rounded-full bg-white/5" />

            <div className="relative z-10">
              <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center mx-auto mb-6">
                <div className="w-11 h-11 rounded-full bg-white flex items-center justify-center">
                  <Logo size={24} />
                </div>
              </div>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-white mb-4 leading-tight">
                {pt
                  ? "Sua próxima viagem merece mais do que uma planilha"
                  : "Your next trip deserves more than a spreadsheet"}
              </h2>
              <p className="text-white/80 text-lg mb-10 max-w-xl mx-auto leading-relaxed">
                {pt
                  ? "Cole um link agora e veja seu roteiro ganhar vida em segundos. Seu primeiro roteiro é por nossa conta."
                  : "Paste a link now and watch your itinerary come alive in seconds. Your first itinerary is on us."}
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Link
                  to={ctaLink}
                  className="bg-white text-coral-600 font-bold px-10 py-4 rounded-full text-base transition-all hover:shadow-xl hover:shadow-black/20 hover:scale-105"
                >
                  {t("landing.ctaButton")}
                </Link>
              </div>
              <p className="text-white/50 text-sm mt-5">
                {pt ? "Primeiro roteiro grátis • Sem cartão" : "First itinerary free • No credit card"}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Analyze result modal */}
      {analyzeResult && (
        <AnalyzeResultModal data={analyzeResult} onClose={() => setAnalyzeResult(null)} />
      )}

      {/* Destination preview modal */}
      {previewDest && (
        <DestinationPreview destination={previewDest} onClose={() => setPreviewDest(null)} />
      )}

      {/* ═══════════════════════════════════════════
          FOOTER
      ═══════════════════════════════════════════ */}
      <footer className="bg-gray-900 text-gray-400 py-16 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-10 mb-10">
            <div>
              <div className="flex items-center gap-2.5 mb-4">
                <Logo size={28} />
                <span className="text-white text-lg font-bold">Voyara</span>
              </div>
              <p className="text-sm text-gray-500 leading-relaxed">
                {pt
                  ? "Transforme inspiração em aventura. Cole um link, a IA faz o resto."
                  : "Turn inspiration into adventure. Paste a link, AI does the rest."}
              </p>
            </div>
            <div>
              <h4 className="text-white font-semibold text-sm mb-4">{pt ? "Produto" : "Product"}</h4>
              <div className="space-y-2.5">
                <Link to={ctaLink} className="block text-sm hover:text-white transition-colors">
                  {pt ? "Criar roteiro" : "Create itinerary"}
                </Link>
                <Link to="/dashboard" className="block text-sm hover:text-white transition-colors">
                  {t("nav.myTrips")}
                </Link>
                <Link to="/features" className="block text-sm hover:text-white transition-colors">
                  {pt ? "Como funciona" : "How it works"}
                </Link>
                <a href="#features" className="block text-sm hover:text-white transition-colors">
                  {pt ? "Funcionalidades" : "Features"}
                </a>
              </div>
            </div>
            <div>
              <h4 className="text-white font-semibold text-sm mb-4">{pt ? "Conta" : "Account"}</h4>
              <div className="space-y-2.5">
                {user ? (
                  <>
                    <Link to="/dashboard" className="block text-sm hover:text-white transition-colors">
                      {t("nav.myTrips")}
                    </Link>
                    <Link to="/dashboard?new=1" className="block text-sm hover:text-white transition-colors">
                      {pt ? "Nova viagem" : "New trip"}
                    </Link>
                  </>
                ) : (
                  <>
                    <Link to="/login" className="block text-sm hover:text-white transition-colors">
                      {t("auth.login")}
                    </Link>
                    <Link to="/login" className="block text-sm hover:text-white transition-colors">
                      {t("auth.register")}
                    </Link>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="border-t border-gray-800 pt-8 flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-sm text-gray-500">{t("landing.footerCopy")}</p>
            <div className="flex items-center gap-4 text-sm">
              <button onClick={toggle} className="hover:text-white transition-colors">
                {pt ? "English" : "Português"}
              </button>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
