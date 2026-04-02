import { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import { useLanguage } from "../i18n/LanguageContext";
import { useAuth } from "../auth/AuthContext";
import Logo from "../components/layout/Logo";
import ShowcaseMap from "../components/landing/ShowcaseMap";

/*
 * Full features walkthrough page — sales-oriented, emotionally compelling.
 * Every mockup looks like the real app with real photos and data.
 * Copy speaks to fears, desires, and doubts of real travelers.
 */

/* ── Animated number hook ── */
function useCountUp(end, duration = 1800) {
  const [count, setCount] = useState(0);
  const ref = useRef(null);
  const started = useRef(false);

  useEffect(() => {
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
  }, [end, duration]);

  return [count, ref];
}

export default function FeaturesPage() {
  const { t, toggle, lang } = useLanguage();
  const { user } = useAuth();
  const pt = lang === "pt-BR";
  const ctaLink = user ? "/dashboard?new=1" : "/login";

  const [hoursCount, hoursRef] = useCountUp(18);
  const [placesCount, placesRef] = useCountUp(45);
  const [accuracyCount, accuracyRef] = useCountUp(98);

  /* Scroll-based active section for mini-nav */
  const [activeSection, setActiveSection] = useState("paste");
  useEffect(() => {
    const sections = ["paste", "discover", "profile", "itinerary", "customize", "map", "details", "extras", "share"];
    const handleScroll = () => {
      for (const id of [...sections].reverse()) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= 200) {
          setActiveSection(id);
          break;
        }
      }
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const NAV_ITEMS = [
    { id: "paste", label: pt ? "Cole o link" : "Paste link", icon: "🔗" },
    { id: "discover", label: pt ? "Descubra" : "Discover", icon: "✨" },
    { id: "profile", label: pt ? "Perfil" : "Profile", icon: "🎯" },
    { id: "itinerary", label: pt ? "Roteiro" : "Itinerary", icon: "📋" },
    { id: "customize", label: pt ? "Personalize" : "Customize", icon: "✏️" },
    { id: "map", label: pt ? "Mapa" : "Map", icon: "🗺️" },
    { id: "details", label: pt ? "Detalhes" : "Details", icon: "💎" },
    { id: "extras", label: pt ? "Extras" : "Extras", icon: "✈️" },
    { id: "share", label: pt ? "Compartilhe" : "Share", icon: "📤" },
  ];

  return (
    <div className="min-h-screen bg-white">
      {/* ═══ TOP NAV ═══ */}
      <nav className="fixed top-0 left-0 right-0 bg-white/90 backdrop-blur-md z-50 border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link to="/" className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
              <Logo size={30} />
              <span className="text-xl font-bold text-gray-900 tracking-tight">Voyara</span>
            </Link>
            <div className="hidden sm:flex items-center gap-1">
              <Link to="/" className="px-3 py-1.5 rounded-lg text-sm font-medium text-gray-500 hover:text-gray-900 hover:bg-gray-50 transition-colors">
                {t("nav.home")}
              </Link>
              <Link to="/features" className="px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 text-gray-900">
                {pt ? "Como funciona" : "How it works"}
              </Link>
              <Link to="/pricing" className="px-3 py-1.5 rounded-lg text-sm font-medium text-gray-500 hover:text-gray-900 hover:bg-gray-50 transition-colors">
                {t("nav.pricing")}
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
              </Link>
            ) : (
              <Link to="/login" className="bg-coral-500 hover:bg-coral-600 text-white text-sm font-semibold px-5 py-2 rounded-full transition-colors shadow-sm">
                {t("landing.startPlanning")}
              </Link>
            )}
          </div>
        </div>
      </nav>

      {/* ═══ STICKY SECTION NAV ═══ */}
      <div className="fixed top-[57px] left-0 right-0 bg-white/80 backdrop-blur-sm z-40 border-b border-gray-100 hidden lg:block">
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex items-center gap-1 py-2 overflow-x-auto scrollbar-hide">
            {NAV_ITEMS.map(({ id, label, icon }) => (
              <a
                key={id}
                href={`#${id}`}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap ${
                  activeSection === id
                    ? "bg-coral-500 text-white shadow-sm"
                    : "text-gray-500 hover:text-gray-900 hover:bg-gray-50"
                }`}
              >
                <span>{icon}</span>
                {label}
              </a>
            ))}
          </div>
        </div>
      </div>

      {/* ═══ HERO ═══ */}
      <section className="pt-32 lg:pt-40 pb-16 px-6 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-violet-50/50 via-coral-50/20 to-white pointer-events-none" />
        <div className="max-w-4xl mx-auto relative text-center">
          <div className="inline-flex items-center gap-2 bg-violet-50 text-violet-600 text-xs font-semibold px-4 py-1.5 rounded-full mb-6 border border-violet-100">
            <span className="w-2 h-2 rounded-full bg-violet-500 animate-pulse" />
            {pt ? "Veja tudo que a Voyara faz por você" : "See everything Voyara does for you"}
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-gray-900 leading-[1.1] tracking-tight mb-6">
            {pt
              ? <><span className="text-coral-500">Aquele vídeo de viagem</span> que você salvou?<br />Vira roteiro em 30 segundos.</>
              : <><span className="text-coral-500">That travel video</span> you saved?<br />Becomes an itinerary in 30 seconds.</>}
          </h1>

          <p className="text-lg sm:text-xl text-gray-500 leading-relaxed mb-10 max-w-2xl mx-auto">
            {pt
              ? "Sem planilha, sem 12 abas abertas, sem gastar o fim de semana inteiro pesquisando. Cole o link → a IA faz tudo → você só viaja."
              : "No spreadsheet, no 12 open tabs, no wasting your whole weekend researching. Paste the link → AI does everything → you just travel."}
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              to={ctaLink}
              className="bg-coral-500 hover:bg-coral-600 text-white font-bold px-8 py-3.5 rounded-full transition-all hover:shadow-lg hover:shadow-coral-200 text-base"
            >
              {pt ? "Quero experimentar agora" : "I want to try it now"}
            </Link>
            <a
              href="#paste"
              className="text-gray-500 hover:text-gray-900 font-medium text-sm transition-colors"
            >
              {pt ? "Ver o passo a passo" : "See the walkthrough"} ↓
            </a>
          </div>
        </div>
      </section>

      {/* ═══ STATS BAR ═══ */}
      <section className="py-10 border-y border-gray-100 bg-gradient-to-r from-gray-50/80 via-white to-gray-50/80">
        <div className="max-w-5xl mx-auto px-6 grid grid-cols-1 sm:grid-cols-3 gap-8 text-center">
          <div ref={hoursRef} className="space-y-1">
            <div className="text-4xl font-black text-coral-500 tracking-tight tabular-nums">{hoursCount}h</div>
            <div className="text-sm font-semibold text-gray-900">{pt ? "Economia de tempo" : "Hours saved"}</div>
            <div className="text-xs text-gray-400">{pt ? "em média por viagem planejada" : "on average per planned trip"}</div>
          </div>
          <div ref={placesRef} className="space-y-1">
            <div className="text-4xl font-black text-violet-500 tracking-tight tabular-nums">{placesCount}+</div>
            <div className="text-sm font-semibold text-gray-900">{pt ? "Lugares por roteiro" : "Places per itinerary"}</div>
            <div className="text-xs text-gray-400">{pt ? "todos validados no Google Maps" : "all validated on Google Maps"}</div>
          </div>
          <div ref={accuracyRef} className="space-y-1">
            <div className="text-4xl font-black text-emerald-500 tracking-tight tabular-nums">{accuracyCount}%</div>
            <div className="text-sm font-semibold text-gray-900">{pt ? "Dados reais" : "Real data"}</div>
            <div className="text-xs text-gray-400">{pt ? "fotos, notas e horários do Google" : "Google photos, ratings and hours"}</div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          STEP 1 — PASTE THE LINK
      ═══════════════════════════════════════════════════════════════ */}
      <section id="paste" className="py-20 px-6 scroll-mt-24">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col lg:flex-row items-center gap-12 lg:gap-16">
            {/* Mockup */}
            <div className="w-full lg:w-1/2">
              <div className="bg-gradient-to-br from-coral-50 to-orange-50 rounded-3xl p-6 sm:p-8 relative overflow-hidden">
                <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-white/10" />

                {/* App-like window */}
                <div className="bg-white rounded-2xl shadow-2xl overflow-hidden relative z-10">
                  {/* Fake browser bar */}
                  <div className="bg-gray-50 border-b border-gray-200 px-4 py-2.5 flex items-center gap-2">
                    <div className="flex gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
                      <div className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
                      <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
                    </div>
                    <div className="flex-1 bg-white rounded-md px-3 py-1 text-[10px] text-gray-400 text-center border border-gray-200">voyara.app</div>
                  </div>

                  <div className="p-5">
                    <div className="flex items-center gap-2 mb-5">
                      <Logo size={20} />
                      <span className="text-sm font-bold text-gray-900">Voyara</span>
                    </div>

                    {/* Input with real URL */}
                    <div className="mb-3">
                      <div className="bg-gray-50 border-2 border-coral-200 rounded-xl px-4 py-3 flex items-center gap-2">
                        <span className="text-gray-400 text-sm">🔗</span>
                        <span className="text-sm text-gray-700 truncate">https://www.instagram.com/reel/C9kL2m...</span>
                        <span className="ml-auto text-[8px] bg-pink-100 text-pink-600 px-1.5 py-0.5 rounded font-bold">Instagram</span>
                      </div>
                    </div>

                    {/* Extracted places preview */}
                    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 mb-3">
                      <div className="flex items-center gap-1.5 mb-2">
                        <span className="text-emerald-600 text-xs">✓</span>
                        <span className="text-xs font-bold text-emerald-700">{pt ? "8 lugares encontrados!" : "8 places found!"}</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {["Torre Eiffel", "Sacré-Cœur", "Le Marais", "Montmartre", "Pont Alexandre III", "Café de Flore", "Tuileries", "Arc de Triomphe"].map(p => (
                          <span key={p} className="bg-white text-[9px] text-gray-600 px-2 py-0.5 rounded-full border border-emerald-200 font-medium">{p}</span>
                        ))}
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <div className="flex-1 bg-coral-500 text-white text-center text-sm font-bold py-2.5 rounded-xl shadow-sm">
                        {pt ? "Criar roteiro" : "Create itinerary"} ✨
                      </div>
                      <div className="flex-1 bg-gray-100 text-gray-600 text-center text-sm font-semibold py-2.5 rounded-xl">
                        {pt ? "Ver lugares" : "See places"} 🔍
                      </div>
                    </div>
                  </div>
                </div>

                {/* Supported platforms */}
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  {[
                    { name: "Instagram", color: "bg-gradient-to-r from-purple-500 to-pink-500" },
                    { name: "YouTube", color: "bg-red-500" },
                    { name: "TikTok", color: "bg-gray-900" },
                    { name: "Blog", color: "bg-blue-500" },
                  ].map(s => (
                    <span key={s.name} className={`${s.color} text-white text-[10px] font-bold px-3 py-1 rounded-full shadow-sm`}>{s.name} ✓</span>
                  ))}
                </div>
              </div>
            </div>

            {/* Text */}
            <div className="w-full lg:w-1/2">
              <div className="inline-flex items-center gap-2 bg-coral-500 text-white text-xs font-bold px-3 py-1.5 rounded-full mb-4">
                <span className="text-sm">🔗</span>
                {pt ? "PASSO 01" : "STEP 01"}
              </div>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4 leading-tight">
                {pt
                  ? <>"Cadê aquele lugar que eu vi naquele vídeo?" <span className="text-coral-500">A gente descobre pra você.</span></>
                  : <>"Where was that place from that video?" <span className="text-coral-500">We find it for you.</span></>}
              </h2>
              <p className="text-gray-500 text-lg leading-relaxed mb-6">
                {pt
                  ? "Sabe quando você salva um reel de Paris às 2h da manhã e pensa \"preciso ir pra lá\"? Mas depois não lembra o nome dos lugares? Cola o link aqui. A IA assiste o vídeo, lê a legenda, e extrai cada restaurante, mirante, rua e atração mencionada. Todos de uma vez."
                  : "You know when you save a Paris reel at 2am thinking \"I need to go there\"? But later you can't remember the place names? Paste the link here. AI watches the video, reads the caption, and extracts every restaurant, viewpoint, street and attraction mentioned. All at once."}
              </p>
              <div className="flex flex-wrap gap-3 text-sm text-gray-400">
                <span className="flex items-center gap-1">✓ {pt ? "Extrai legendas e áudio" : "Extracts captions and audio"}</span>
                <span className="flex items-center gap-1">✓ {pt ? "Valida cada lugar no Google" : "Validates every place on Google"}</span>
                <span className="flex items-center gap-1">✓ {pt ? "Funciona com qualquer link" : "Works with any link"}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          STEP 2 — DISCOVER HIDDEN GEMS
      ═══════════════════════════════════════════════════════════════ */}
      <section id="discover" className="py-20 px-6 bg-gray-50 scroll-mt-24">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col lg:flex-row-reverse items-center gap-12 lg:gap-16">
            {/* Mockup */}
            <div className="w-full lg:w-1/2">
              <div className="bg-gradient-to-br from-violet-50 to-purple-50 rounded-3xl p-6 sm:p-8 relative overflow-hidden">
                <div className="absolute -bottom-8 -left-8 w-32 h-32 rounded-full bg-white/10" />

                <div className="space-y-2.5 relative z-10">
                  {/* Places with REAL photos */}
                  {[
                    { name: "Rue Crémieux", img: "https://images.unsplash.com/photo-1550340499-a6c60fc8287c?w=120&h=120&fit=crop&q=80", tag: pt ? "📸 Do vídeo" : "📸 From video", tagColor: "bg-blue-100 text-blue-700", rating: "4.3", reviews: "12,847", desc: pt ? "A rua mais colorida e instagramável de Paris" : "The most colorful and Instagrammable street in Paris" },
                    { name: "Café de Flore", img: "https://images.unsplash.com/photo-1514933651103-005eec06c04b?w=120&h=120&fit=crop&q=80", tag: pt ? "📸 Do vídeo" : "📸 From video", tagColor: "bg-blue-100 text-blue-700", rating: "4.2", reviews: "18,234", desc: pt ? "O café onde Hemingway escrevia — clássico absoluto" : "The café where Hemingway wrote — absolute classic" },
                    { name: "Le Bouillon Chartier", img: "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=120&h=120&fit=crop&q=80", tag: pt ? "💎 IA descobriu" : "💎 AI found", tagColor: "bg-amber-100 text-amber-700", rating: "4.5", reviews: "32,891", desc: pt ? "Restaurante de 1896 com pratos a €12 — fila de locais!" : "1896 restaurant with €12 dishes — locals line up!" },
                    { name: "Parc des Buttes-Chaumont", img: "https://images.unsplash.com/photo-1585944672394-80f0a9565cce?w=120&h=120&fit=crop&q=80", tag: pt ? "💎 IA descobriu" : "💎 AI found", tagColor: "bg-amber-100 text-amber-700", rating: "4.7", reviews: "8,456", desc: pt ? "O parque secreto dos parisienses — zero turista, vista incrível" : "The secret park of Parisians — zero tourists, incredible view" },
                  ].map((place, i) => (
                    <div key={i} className="bg-white rounded-xl p-3 shadow-sm flex items-start gap-3">
                      <img src={place.img} alt={place.name} className="w-14 h-14 rounded-lg object-cover flex-shrink-0" loading="lazy" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-sm font-bold text-gray-900 truncate">{place.name}</span>
                          <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ${place.tagColor}`}>{place.tag}</span>
                        </div>
                        <p className="text-[11px] text-gray-500 leading-snug mb-1">{place.desc}</p>
                        <div className="flex items-center gap-2">
                          <span className="text-amber-500 text-[11px] font-bold">★ {place.rating}</span>
                          <span className="text-[10px] text-gray-400">({place.reviews})</span>
                        </div>
                      </div>
                    </div>
                  ))}

                  <div className="text-center pt-1">
                    <span className="text-[11px] text-violet-500 font-semibold">
                      {pt ? "💎 A IA encontrou 4 lugares que o vídeo não mostrou" : "💎 AI found 4 places the video didn't show"}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Text */}
            <div className="w-full lg:w-1/2">
              <div className="inline-flex items-center gap-2 bg-violet-500 text-white text-xs font-bold px-3 py-1.5 rounded-full mb-4">
                <span className="text-sm">✨</span>
                {pt ? "PASSO 02" : "STEP 02"}
              </div>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4 leading-tight">
                {pt
                  ? <>"E se existem lugares <span className="text-violet-500">ainda melhores</span> que o vídeo não mostrou?"</>
                  : <>"What if there are <span className="text-violet-500">even better places</span> the video didn't show?"</>}
              </h2>
              <p className="text-gray-500 text-lg leading-relaxed mb-6">
                {pt
                  ? "Aquele criador mostrou 5 lugares em Paris — mas e os outros 20 que ele não teve tempo de filmar? A IA analisa a região, cruza com avaliações do Google, e encontra cafés escondidos, restaurantes que só os locais conhecem, e aquele parque sem nenhum turista com a melhor vista da cidade."
                  : "That creator showed 5 places in Paris — but what about the other 20 they didn't have time to film? AI analyzes the region, cross-references with Google ratings, and finds hidden cafes, restaurants only locals know, and that tourist-free park with the best city view."}
              </p>
              <div className="bg-violet-50 rounded-xl p-4 border border-violet-200">
                <p className="text-sm text-violet-700 font-medium">
                  {pt
                    ? "💡 Você não precisa ficar horas pesquisando \"melhores restaurantes em Paris\" — a IA já fez isso e separou os melhores pra você."
                    : "💡 You don't need to spend hours searching \"best restaurants in Paris\" — AI already did it and picked the best ones for you."}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          STEP 3 — TRAVELER PROFILE
      ═══════════════════════════════════════════════════════════════ */}
      <section id="profile" className="py-20 px-6 scroll-mt-24">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col lg:flex-row items-center gap-12 lg:gap-16">
            {/* Mockup */}
            <div className="w-full lg:w-1/2">
              <div className="bg-gradient-to-br from-emerald-50 to-green-50 rounded-3xl p-6 sm:p-8 relative overflow-hidden">
                <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-white/10" />

                <div className="bg-white rounded-2xl shadow-2xl p-5 relative z-10">
                  {/* Header with traveler photo */}
                  <div className="flex items-center gap-3 mb-5">
                    <img
                      src="https://images.unsplash.com/photo-1539635278303-d4002c07eae3?w=100&h=100&fit=crop&q=80"
                      alt=""
                      className="w-14 h-14 rounded-xl object-cover shadow-sm"
                      loading="lazy"
                    />
                    <div>
                      <div className="text-base font-bold text-gray-900">{pt ? "Seu Perfil de Viajante" : "Your Traveler Profile"}</div>
                      <div className="text-xs text-gray-400">{pt ? "Baseado nos seus links" : "Based on your links"}</div>
                    </div>
                  </div>

                  {/* Style description */}
                  <div className="bg-emerald-50 rounded-xl p-3 mb-4 border border-emerald-200">
                    <p className="text-xs text-emerald-800 leading-relaxed">
                      {pt
                        ? "🎒 Viajante aventureiro que ama gastronomia local, fotografia de rua e explorar bairros autênticos. Gosta de mirantes ao pôr do sol, cafés com charme e experiências únicas longe das multidões."
                        : "🎒 Adventurous traveler who loves local cuisine, street photography and exploring authentic neighborhoods. Enjoys sunset viewpoints, charming cafes and unique experiences away from crowds."}
                    </p>
                  </div>

                  {/* Interests */}
                  <div className="mb-4">
                    <div className="text-[10px] text-gray-400 font-semibold uppercase mb-2">{pt ? "O que você curte" : "What you enjoy"}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        { emoji: "🍽️", label: pt ? "Gastronomia" : "Food", active: true },
                        { emoji: "📸", label: pt ? "Fotografia" : "Photography", active: true },
                        { emoji: "🌅", label: pt ? "Mirantes" : "Viewpoints", active: true },
                        { emoji: "☕", label: pt ? "Cafés" : "Cafes", active: true },
                        { emoji: "🏛️", label: pt ? "Museus" : "Museums", active: false },
                        { emoji: "🛍️", label: pt ? "Compras" : "Shopping", active: false },
                        { emoji: "🌳", label: pt ? "Natureza" : "Nature", active: true },
                        { emoji: "🎭", label: pt ? "Vida Noturna" : "Nightlife", active: false },
                      ].map(tag => (
                        <span
                          key={tag.label}
                          className={`text-[10px] font-semibold px-2.5 py-1 rounded-full border ${
                            tag.active
                              ? "bg-emerald-50 text-emerald-700 border-emerald-300"
                              : "bg-gray-50 text-gray-400 border-gray-200"
                          }`}
                        >
                          {tag.emoji} {tag.label}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Pace */}
                  <div className="mb-5">
                    <div className="text-[10px] text-gray-400 font-semibold uppercase mb-2">{pt ? "Seu ritmo" : "Your pace"}</div>
                    <div className="flex gap-2">
                      {[
                        { label: pt ? "Relaxado" : "Relaxed", icon: "🐢", active: false },
                        { label: pt ? "Moderado" : "Moderate", icon: "🚶", active: true },
                        { label: pt ? "Intenso" : "Intense", icon: "🏃", active: false },
                      ].map(p => (
                        <span key={p.label} className={`text-[11px] font-bold px-3 py-2 rounded-xl flex items-center gap-1.5 ${p.active ? "bg-emerald-500 text-white shadow-sm" : "bg-gray-100 text-gray-400"}`}>
                          {p.icon} {p.label}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* CTA */}
                  <button className="w-full bg-emerald-500 text-white font-bold py-3 rounded-xl shadow-sm text-sm">
                    {pt ? "✓ Confirmar e Gerar Roteiro" : "✓ Confirm & Generate Itinerary"}
                  </button>
                  <p className="text-center text-[10px] text-gray-400 mt-2">
                    {pt ? "Você pode editar tudo antes de confirmar" : "You can edit everything before confirming"}
                  </p>
                </div>
              </div>
            </div>

            {/* Text */}
            <div className="w-full lg:w-1/2">
              <div className="inline-flex items-center gap-2 bg-emerald-500 text-white text-xs font-bold px-3 py-1.5 rounded-full mb-4">
                <span className="text-sm">🎯</span>
                {pt ? "PASSO 03" : "STEP 03"}
              </div>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4 leading-tight">
                {pt
                  ? <>A IA entende <span className="text-emerald-500">quem você é</span> — e monta o roteiro <span className="text-emerald-500">do seu jeito</span></>
                  : <>AI understands <span className="text-emerald-500">who you are</span> — and builds the itinerary <span className="text-emerald-500">your way</span></>}
              </h2>
              <p className="text-gray-500 text-lg leading-relaxed mb-6">
                {pt
                  ? "Antes de gerar qualquer coisa, a IA analisa o que você salvou e descobre: você curte mais gastronomia ou museus? Prefere acordar cedo ou ir com calma? Gosta de lugares escondidos ou dos clássicos? Com base nisso, seu roteiro é feito sob medida — sem genéricos, sem \"top 10 turístico\"."
                  : "Before generating anything, AI analyzes what you saved and discovers: do you prefer food or museums? Like waking up early or taking it slow? Enjoy hidden spots or the classics? Based on this, your itinerary is tailor-made — no generics, no \"tourist top 10.\""}
              </p>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2 text-gray-600">
                  <span className="text-emerald-500">✓</span>
                  {pt ? "Edite interesses, ritmo e estilo antes de gerar" : "Edit interests, pace and style before generating"}
                </div>
                <div className="flex items-center gap-2 text-gray-600">
                  <span className="text-emerald-500">✓</span>
                  {pt ? "A IA prioriza o que você realmente gosta" : "AI prioritizes what you actually enjoy"}
                </div>
                <div className="flex items-center gap-2 text-gray-600">
                  <span className="text-emerald-500">✓</span>
                  {pt ? "Nada de roteiro genérico — é personalizado pra você" : "No generic itinerary — it's personalized for you"}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          STEP 4 — FULL ITINERARY
      ═══════════════════════════════════════════════════════════════ */}
      <section id="itinerary" className="py-20 px-6 bg-gray-50 scroll-mt-24">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col lg:flex-row-reverse items-center gap-12 lg:gap-16">
            {/* Mockup */}
            <div className="w-full lg:w-1/2">
              <div className="bg-gradient-to-br from-blue-50 to-sky-50 rounded-3xl p-6 sm:p-8 relative overflow-hidden">
                <div className="absolute -bottom-8 -right-8 w-36 h-36 rounded-full bg-white/10" />

                <div className="bg-white rounded-2xl shadow-2xl overflow-hidden relative z-10">
                  {/* Day header */}
                  <div className="bg-gradient-to-r from-coral-500 to-orange-500 px-5 py-3 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center text-white text-sm font-black">1</div>
                    <div>
                      <div className="text-white text-sm font-bold">{pt ? "Dia 1 — Montmartre & Sacré-Cœur" : "Day 1 — Montmartre & Sacré-Cœur"}</div>
                      <div className="text-white/60 text-[10px]">{pt ? "Segunda, 14 de julho" : "Monday, July 14"}</div>
                    </div>
                  </div>

                  {/* Items */}
                  <div className="p-4 space-y-3">
                    {[
                      { emoji: "☕", name: "Café des Deux Moulins", desc: pt ? "O café do filme Amélie Poulain — peça o crème brûlée!" : "The café from Amélie — order the crème brûlée!", dur: "~45 min", rating: "4.4", img: "https://images.unsplash.com/photo-1554118811-1e0d58224f24?w=80&h=80&fit=crop&q=80", tag: pt ? "Café da manhã" : "Breakfast" },
                      { emoji: "⛪", name: "Sacré-Cœur", desc: pt ? "Suba pela escadaria pra vista mais linda de Paris. Melhor antes das 10h!" : "Climb the stairs for Paris' most beautiful view. Best before 10am!", dur: "~1h", rating: "4.7", img: "https://images.unsplash.com/photo-1568684333877-4d39f2b589b8?w=80&h=80&fit=crop&q=80", sunset: true },
                      { emoji: "🎨", name: "Place du Tertre", desc: pt ? "Praça dos artistas de rua — veja pintores ao vivo e compre uma aquarela" : "Street artists square — watch live painters and buy a watercolor", dur: "~30 min", rating: "4.3", img: "https://images.unsplash.com/photo-1541882131556-7e0b45407e67?w=80&h=80&fit=crop&q=80" },
                      { emoji: "🍽️", name: "Le Bouillon Chartier", desc: pt ? "Restaurante de 1896 — pratos tradicionais a partir de €12. Fila anda rápido!" : "1896 restaurant — traditional dishes from €12. Line moves fast!", dur: "~1h15", rating: "4.5", img: "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=80&h=80&fit=crop&q=80", tag: pt ? "Almoço" : "Lunch", gem: true },
                      { emoji: "🖼️", name: pt ? "Museu de l'Orangerie" : "Musée de l'Orangerie", desc: pt ? "Os Nenúfares de Monet em salas ovaladas — 40 min é suficiente" : "Monet's Water Lilies in oval rooms — 40 min is enough", dur: "~40 min", rating: "4.6", img: "https://images.unsplash.com/photo-1499426600726-7f5b4e56e3b4?w=80&h=80&fit=crop&q=80" },
                      { emoji: "🌅", name: "Pont Alexandre III", desc: pt ? "A ponte mais bonita de Paris — PERFEITA no pôr do sol às 20h30" : "The most beautiful bridge in Paris — PERFECT at sunset around 8:30pm", dur: "~30 min", rating: "4.8", img: "https://images.unsplash.com/photo-1499856871958-5b9627545d1a?w=80&h=80&fit=crop&q=80", sunset: true },
                    ].map((item, i) => (
                      <div key={i} className="flex items-start gap-3">
                        <img src={item.img} alt={item.name} className="w-12 h-12 rounded-lg object-cover flex-shrink-0 shadow-sm" loading="lazy" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[12px] font-bold text-gray-900">{item.emoji} {item.name}</span>
                            <span className="text-gray-300 text-[10px]">•</span>
                            <span className="text-[10px] text-gray-400">{item.dur}</span>
                            {item.sunset && <span className="bg-orange-100 text-orange-600 text-[7px] font-bold px-1.5 py-0.5 rounded-full">🌅</span>}
                            {item.gem && <span className="bg-amber-100 text-amber-700 text-[7px] font-bold px-1.5 py-0.5 rounded-full">💎</span>}
                            {item.tag && <span className="bg-blue-50 text-blue-600 text-[7px] font-bold px-1.5 py-0.5 rounded-full">{item.tag}</span>}
                          </div>
                          <p className="text-[10px] text-gray-500 leading-snug mt-0.5">{item.desc}</p>
                          <div className="flex items-center gap-1 mt-0.5">
                            <span className="text-amber-500 text-[10px] font-bold">★ {item.rating}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* More days */}
                  <div className="border-t border-gray-100 px-4 py-2.5 flex items-center gap-2">
                    {[
                      { n: "2", label: pt ? "Marais & Île" : "Marais & Île", color: "bg-violet-500" },
                      { n: "3", label: pt ? "Louvre & Ópera" : "Louvre & Opéra", color: "bg-emerald-500" },
                      { n: "4", label: pt ? "Versailles" : "Versailles", color: "bg-amber-500" },
                    ].map(d => (
                      <span key={d.n} className="flex items-center gap-1 bg-gray-50 rounded-lg px-2 py-1.5">
                        <span className={`w-5 h-5 rounded-md ${d.color} text-white text-[9px] font-bold flex items-center justify-center`}>{d.n}</span>
                        <span className="text-[9px] text-gray-500 font-medium">{d.label}</span>
                      </span>
                    ))}
                    <span className="text-[9px] text-gray-400">...</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Text */}
            <div className="w-full lg:w-1/2">
              <div className="inline-flex items-center gap-2 bg-blue-500 text-white text-xs font-bold px-3 py-1.5 rounded-full mb-4">
                <span className="text-sm">📋</span>
                {pt ? "PASSO 04" : "STEP 04"}
              </div>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4 leading-tight">
                {pt
                  ? <>Um dia inteiro de viagem <span className="text-blue-500">organizado em segundos</span></>
                  : <>A full travel day <span className="text-blue-500">organized in seconds</span></>}
              </h2>
              <p className="text-gray-500 text-lg leading-relaxed mb-6">
                {pt
                  ? "Nada de \"Dia 1: Louvre\". A IA monta um dia REAL: começa no café mais charmoso do bairro, passa pelas atrações agrupadas por proximidade, sugere onde almoçar na hora certa, e coloca o mirante mais bonito no pôr do sol. Cada lugar com foto, avaliação, dica prática e tempo estimado."
                  : "No more \"Day 1: Louvre\". AI creates a REAL day: starts at the neighborhood's most charming café, groups nearby attractions, suggests where to lunch at the right time, and places the most beautiful viewpoint at sunset. Each place with photo, rating, practical tip and estimated time."}
              </p>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2 text-gray-600">
                  <span className="text-blue-500">✓</span>
                  {pt ? "Lugares agrupados por proximidade — sem ziguezague" : "Places grouped by proximity — no zigzagging"}
                </div>
                <div className="flex items-center gap-2 text-gray-600">
                  <span className="text-blue-500">✓</span>
                  {pt ? "Mirantes no pôr do sol, mercados de manhã" : "Viewpoints at sunset, markets in the morning"}
                </div>
                <div className="flex items-center gap-2 text-gray-600">
                  <span className="text-blue-500">✓</span>
                  {pt ? "Dicas práticas em cada lugar (\"fila anda rápido!\")" : "Practical tips at each place (\"line moves fast!\")"}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          STEP 5 — CUSTOMIZE & REFINE WITH AI
      ═══════════════════════════════════════════════════════════════ */}
      <section id="customize" className="py-20 px-6 scroll-mt-24">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col lg:flex-row items-center gap-12 lg:gap-16">
            {/* Mockup */}
            <div className="w-full lg:w-1/2">
              <div className="bg-gradient-to-br from-amber-50 to-yellow-50 rounded-3xl p-6 sm:p-8 relative overflow-hidden">
                <div className="absolute -top-8 -left-8 w-32 h-32 rounded-full bg-white/10" />

                <div className="space-y-3 relative z-10">
                  {/* AI Feedback mockup */}
                  <div className="bg-white rounded-2xl shadow-xl p-5">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-lg">✏️</span>
                      <span className="text-sm font-bold text-gray-900">{pt ? "Refinar com IA" : "Refine with AI"}</span>
                    </div>
                    <div className="bg-amber-50 rounded-xl p-3 border border-amber-200 mb-3">
                      <p className="text-xs text-amber-800">
                        {pt
                          ? "💬 \"Tira o museu e coloca mais um café legal. E quero jantar com vista pra Torre Eiffel.\""
                          : "💬 \"Remove the museum and add another cool café. And I want dinner with a view of the Eiffel Tower.\""}
                      </p>
                    </div>
                    <div className="bg-coral-500 text-white text-center text-xs font-bold py-2.5 rounded-xl">
                      {pt ? "Refinar este dia" : "Refine this day"} ✨
                    </div>
                  </div>

                  {/* Swap suggestion mockup */}
                  <div className="bg-white rounded-2xl shadow-xl p-4">
                    <div className="text-[10px] text-gray-400 font-semibold uppercase mb-2">{pt ? "Trocar por alternativa" : "Swap for alternative"}</div>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 bg-red-50 rounded-lg p-2 text-center border border-red-200">
                        <div className="text-xs font-bold text-red-500 line-through">{pt ? "Museu do Louvre" : "Louvre Museum"}</div>
                        <div className="text-[9px] text-red-400">★ 4.7 • ~3h</div>
                      </div>
                      <span className="text-gray-400 text-lg">→</span>
                      <div className="flex-1 bg-emerald-50 rounded-lg p-2 text-center border border-emerald-200">
                        <div className="text-xs font-bold text-emerald-700">Shakespeare & Co.</div>
                        <div className="text-[9px] text-emerald-500">★ 4.6 • ~30 min</div>
                      </div>
                    </div>
                  </div>

                  {/* Quick actions */}
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { icon: "🔄", label: pt ? "Trocar" : "Swap" },
                      { icon: "➕", label: pt ? "Adicionar" : "Add" },
                      { icon: "💡", label: pt ? "Sugestões" : "Suggestions" },
                      { icon: "↕️", label: pt ? "Arrastar" : "Drag" },
                    ].map(a => (
                      <div key={a.label} className="bg-white rounded-xl p-2 text-center shadow-sm">
                        <div className="text-base">{a.icon}</div>
                        <div className="text-[8px] font-semibold text-gray-500 mt-0.5">{a.label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Text */}
            <div className="w-full lg:w-1/2">
              <div className="inline-flex items-center gap-2 bg-amber-500 text-white text-xs font-bold px-3 py-1.5 rounded-full mb-4">
                <span className="text-sm">✏️</span>
                {pt ? "PASSO 05" : "STEP 05"}
              </div>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4 leading-tight">
                {pt
                  ? <>"<span className="text-amber-500">Não gostei desse lugar</span>" — sem problema, a IA troca na hora</>
                  : <>"<span className="text-amber-500">I don't like this place</span>" — no problem, AI swaps it instantly</>}
              </h2>
              <p className="text-gray-500 text-lg leading-relaxed mb-6">
                {pt
                  ? "Escreva uma frasezinha simples e a IA refaz o dia inteiro. Quer trocar um restaurante? Quer mais cafés e menos museus? Prefere jantar com vista? É só pedir. Você também pode arrastar pra reordenar, trocar um lugar por uma alternativa parecida, ou pedir novas sugestões."
                  : "Write a simple sentence and AI remakes the entire day. Want to swap a restaurant? Want more cafes and fewer museums? Prefer dinner with a view? Just ask. You can also drag to reorder, swap a place for a similar alternative, or request new suggestions."}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          STEP 6 — INTERACTIVE MAP
      ═══════════════════════════════════════════════════════════════ */}
      <section id="map" className="py-20 px-6 bg-gray-50 scroll-mt-24">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col lg:flex-row-reverse items-center gap-12 lg:gap-16">
            {/* Mockup */}
            <div className="w-full lg:w-1/2">
              <div className="bg-gradient-to-br from-emerald-50 to-teal-50 rounded-3xl p-6 sm:p-8 relative overflow-hidden">
                <div className="absolute -bottom-10 -right-10 w-40 h-40 rounded-full bg-white/10" />

                <div className="bg-white rounded-2xl shadow-2xl overflow-hidden relative z-10">
                  {/* Map — Real Google Maps with markers + routes */}
                  <div className="relative h-56">
                    <ShowcaseMap
                      className="w-full h-full"
                      visiblePins={18}
                      showRoutes={true}
                      showHotel={true}
                      showHotelInfo={true}
                      zoom={13}
                    >
                      {/* Distance badges */}
                      <div className="absolute top-3 left-3 flex flex-col gap-1.5 z-20 pointer-events-none">
                        <span className="bg-orange-500 text-white text-[9px] font-bold px-2.5 py-1 rounded-full shadow-lg">{pt ? "Dia 1 • 9,9 km" : "Day 1 • 9.9 km"}</span>
                        <span className="bg-blue-500 text-white text-[9px] font-bold px-2.5 py-1 rounded-full shadow-lg">{pt ? "Dia 2 • 4,9 km" : "Day 2 • 4.9 km"}</span>
                        <span className="bg-emerald-500 text-white text-[9px] font-bold px-2.5 py-1 rounded-full shadow-lg">{pt ? "Dia 3 • 6,0 km" : "Day 3 • 6.0 km"}</span>
                      </div>
                    </ShowcaseMap>
                  </div>

                  {/* Info bar */}
                  <div className="p-3 border-t border-gray-100">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1.5">
                          <span className="bg-coral-500 w-3 h-3 rounded-full border border-white shadow-sm" />
                          <span className="text-[10px] text-gray-600 font-medium">{pt ? "Dia 1" : "Day 1"}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="bg-blue-500 w-3 h-3 rounded-full border border-white shadow-sm" />
                          <span className="text-[10px] text-gray-600 font-medium">{pt ? "Dia 2" : "Day 2"}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="bg-gray-900 w-3 h-3 rounded-md border border-white shadow-sm" />
                          <span className="text-[10px] text-gray-600 font-medium">Hotel</span>
                        </div>
                      </div>
                      <span className="bg-blue-600 text-white text-[9px] font-bold px-2.5 py-1.5 rounded-lg shadow-sm cursor-pointer hover:bg-blue-700 transition-colors flex items-center gap-1">
                        <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                        Google Maps
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Text */}
            <div className="w-full lg:w-1/2">
              <div className="inline-flex items-center gap-2 bg-emerald-600 text-white text-xs font-bold px-3 py-1.5 rounded-full mb-4">
                <span className="text-sm">🗺️</span>
                {pt ? "PASSO 06" : "STEP 06"}
              </div>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4 leading-tight">
                {pt
                  ? <>Seu hotel, suas atrações, tudo no <span className="text-emerald-600">mesmo mapa</span></>
                  : <>Your hotel, your attractions, all on the <span className="text-emerald-600">same map</span></>}
              </h2>
              <p className="text-gray-500 text-lg leading-relaxed mb-6">
                {pt
                  ? "Chega de ficar imaginando \"será que esse lugar é longe do hotel?\". No mapa interativo, você vê o pin roxo do seu hotel e os pins coloridos de cada dia. Clique em qualquer atração, veja os detalhes, e abra direto no Google Maps pra navegar. Filtre por dia pra ver só as atrações daquele dia."
                  : "No more wondering \"is this place far from the hotel?\". On the interactive map, you see your hotel's purple pin and the color-coded pins for each day. Click any attraction, see details, and open directly in Google Maps to navigate. Filter by day to see only that day's attractions."}
              </p>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2 text-gray-600">
                  <span className="text-emerald-500">✓</span>
                  {pt ? "Hotel com pin roxo — sempre visível" : "Hotel with purple pin — always visible"}
                </div>
                <div className="flex items-center gap-2 text-gray-600">
                  <span className="text-emerald-500">✓</span>
                  {pt ? "Linhas tracejadas do hotel até as atrações" : "Dashed lines from hotel to attractions"}
                </div>
                <div className="flex items-center gap-2 text-gray-600">
                  <span className="text-emerald-500">✓</span>
                  {pt ? "Clique e abra direto no Google Maps" : "Click and open directly in Google Maps"}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          STEP 7 — PLACE DETAILS SIDEBAR
      ═══════════════════════════════════════════════════════════════ */}
      <section id="details" className="py-20 px-6 scroll-mt-24">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col lg:flex-row items-center gap-12 lg:gap-16">
            {/* Mockup */}
            <div className="w-full lg:w-1/2">
              <div className="bg-gradient-to-br from-pink-50 to-rose-50 rounded-3xl p-6 sm:p-8 relative overflow-hidden">
                <div className="absolute -top-10 -left-10 w-36 h-36 rounded-full bg-white/10" />

                <div className="bg-white rounded-2xl shadow-2xl overflow-hidden relative z-10">
                  {/* Place photo */}
                  <div className="relative h-36">
                    <img
                      src="https://images.unsplash.com/photo-1568684333877-4d39f2b589b8?w=500&h=250&fit=crop&q=80"
                      alt="Sacré-Cœur"
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                    <div className="absolute bottom-2 right-2 bg-black/60 text-white text-[9px] font-bold px-2 py-1 rounded-lg backdrop-blur-sm">
                      📷 Google Maps
                    </div>
                  </div>

                  <div className="p-4 space-y-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-bold text-gray-900">⛪ Sacré-Cœur</h3>
                        <span className="bg-orange-100 text-orange-600 text-[8px] font-bold px-1.5 py-0.5 rounded-full">🌅 {pt ? "Pôr do sol" : "Sunset"}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-amber-500 text-xs font-bold">★ 4.7</span>
                        <span className="text-[10px] text-gray-400">(245,891 {pt ? "avaliações" : "reviews"})</span>
                        <span className="text-[10px] text-gray-400">•</span>
                        <span className="text-[10px] text-gray-500">⏱ ~1h</span>
                        <span className="text-[10px] text-gray-400">•</span>
                        <span className="text-[10px] text-emerald-600 font-semibold">{pt ? "Grátis" : "Free"}</span>
                      </div>
                    </div>

                    {/* Tip */}
                    <div className="bg-emerald-50 rounded-xl p-3 border-l-3 border-emerald-400">
                      <div className="text-[10px] text-emerald-600 font-bold mb-0.5">💡 {pt ? "Dica da Voyara" : "Voyara tip"}</div>
                      <p className="text-[11px] text-emerald-800 leading-relaxed">
                        {pt
                          ? "Suba pela escadaria (não pelo funicular) — a vista durante a subida já vale. Chegue antes das 10h pra foto sem multidão. A basílica é grátis, só o domo custa €7."
                          : "Climb the stairs (not the funicular) — the view during the climb is worth it. Arrive before 10am for crowd-free photos. The basilica is free, only the dome costs €7."}
                      </p>
                    </div>

                    {/* Hours */}
                    <div className="bg-gray-50 rounded-xl p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-gray-500 font-semibold">{pt ? "Horário de funcionamento" : "Opening hours"}</span>
                        <span className="text-[10px] text-emerald-600 font-bold">{pt ? "Aberto agora" : "Open now"}</span>
                      </div>
                      <div className="text-xs text-gray-700 mt-1 font-medium">06:00 - 22:30</div>
                    </div>

                    {/* Address */}
                    <div className="text-[11px] text-gray-500">📍 35 Rue du Chevalier de la Barre, 75018 Paris</div>

                    {/* Actions */}
                    <div className="flex gap-2">
                      <span className="flex-1 bg-blue-500 text-white text-[10px] font-bold py-2 rounded-xl text-center shadow-sm">
                        🗺️ {pt ? "Ver no Maps" : "View on Maps"}
                      </span>
                      <span className="flex-1 bg-gray-100 text-gray-600 text-[10px] font-bold py-2 rounded-xl text-center">
                        🌐 Website
                      </span>
                    </div>

                    {/* Personal note */}
                    <div className="bg-amber-50 rounded-xl p-2.5 border border-amber-200">
                      <div className="text-[9px] text-amber-600 font-bold mb-0.5">✏️ {pt ? "Sua nota" : "Your note"}</div>
                      <p className="text-[10px] text-amber-800 italic">
                        {pt ? "Levar tripé pra foto do pôr do sol!" : "Bring tripod for sunset photo!"}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Text */}
            <div className="w-full lg:w-1/2">
              <div className="inline-flex items-center gap-2 bg-pink-500 text-white text-xs font-bold px-3 py-1.5 rounded-full mb-4">
                <span className="text-sm">💎</span>
                {pt ? "PASSO 07" : "STEP 07"}
              </div>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4 leading-tight">
                {pt
                  ? <>Cada lugar com <span className="text-pink-500">tudo que você precisa</span> saber</>
                  : <>Every place with <span className="text-pink-500">everything you need</span> to know</>}
              </h2>
              <p className="text-gray-500 text-lg leading-relaxed mb-6">
                {pt
                  ? "Abre a barra lateral de qualquer atração e encontra tudo: foto real do Google, avaliação com número de reviews, dicas práticas (\"suba pela escada, não pelo funicular\"), horário de funcionamento, preço, endereço exato. Adicione suas próprias notas — tipo \"reserva no restaurante às 19h\" ou \"levar câmera\"."
                  : "Open any attraction's sidebar and find everything: real Google photo, rating with review count, practical tips (\"take the stairs, not the funicular\"), opening hours, price, exact address. Add your own notes — like \"restaurant reservation at 7pm\" or \"bring camera\"."}
              </p>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2 text-gray-600">
                  <span className="text-pink-500">✓</span>
                  {pt ? "Fotos reais, avaliações e horários do Google" : "Real Google photos, ratings and hours"}
                </div>
                <div className="flex items-center gap-2 text-gray-600">
                  <span className="text-pink-500">✓</span>
                  {pt ? "Dicas como \"fecha na segunda\" ou \"melhor no pôr do sol\"" : "Tips like \"closed on Mondays\" or \"best at sunset\""}
                </div>
                <div className="flex items-center gap-2 text-gray-600">
                  <span className="text-pink-500">✓</span>
                  {pt ? "Suas notas pessoais salvas com o roteiro" : "Your personal notes saved with the itinerary"}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          STEP 8 — FLIGHTS, HOTEL, NOTES
      ═══════════════════════════════════════════════════════════════ */}
      <section id="extras" className="py-20 px-6 bg-gray-50 scroll-mt-24">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col lg:flex-row-reverse items-center gap-12 lg:gap-16">
            {/* Mockup */}
            <div className="w-full lg:w-1/2">
              <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-3xl p-6 sm:p-8 relative overflow-hidden">
                <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-white/10" />

                <div className="space-y-3 relative z-10">
                  {/* Flight card — boarding pass style */}
                  <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
                    <div className="bg-gradient-to-r from-blue-500 to-blue-600 px-4 py-2 flex items-center gap-2">
                      <span className="text-white text-sm">✈️</span>
                      <span className="text-white text-xs font-bold">{pt ? "Seus Voos" : "Your Flights"}</span>
                    </div>
                    <div className="p-4">
                      <div className="flex items-center gap-4">
                        <div className="text-center">
                          <div className="text-xl font-black text-gray-900">GRU</div>
                          <div className="text-[9px] text-gray-400">{pt ? "São Paulo" : "São Paulo"}</div>
                          <div className="text-[10px] text-gray-600 font-medium">23:45</div>
                        </div>
                        <div className="flex-1 text-center relative">
                          <div className="h-px bg-gray-300 absolute top-1/2 left-0 right-0" style={{ borderTop: "2px dashed #d1d5db" }} />
                          <span className="relative bg-white px-2 text-[10px] text-gray-500 font-medium">✈ LATAM 8045</span>
                          <div className="text-[8px] text-gray-400 mt-0.5">11h25min</div>
                        </div>
                        <div className="text-center">
                          <div className="text-xl font-black text-gray-900">CDG</div>
                          <div className="text-[9px] text-gray-400">Paris</div>
                          <div className="text-[10px] text-gray-600 font-medium">14:10</div>
                        </div>
                      </div>
                      <div className="mt-2 text-[9px] text-gray-400 text-center">
                        14 {pt ? "julho" : "July"} 2025 • {pt ? "Assentos" : "Seats"}: 24A, 24B
                      </div>
                    </div>
                  </div>

                  {/* Hotel card */}
                  <div className="bg-white rounded-2xl shadow-xl p-4">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-xl bg-violet-100 flex items-center justify-center text-xl">🏨</div>
                      <div className="flex-1">
                        <div className="text-sm font-bold text-gray-900">Hôtel Le Marais</div>
                        <div className="text-[10px] text-gray-500">📍 12 Rue de Bretagne, 75003</div>
                        <div className="flex items-center gap-3 mt-1 text-[10px]">
                          <span className="text-gray-600">Check-in: <span className="font-bold">14 Jul</span></span>
                          <span className="text-gray-600">Check-out: <span className="font-bold">20 Jul</span></span>
                          <span className="text-violet-500 font-bold">6 {pt ? "noites" : "nights"}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Notes card */}
                  <div className="bg-white rounded-2xl shadow-xl p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm">📝</span>
                      <span className="text-xs font-bold text-gray-900">{pt ? "Notas da Viagem" : "Trip Notes"}</span>
                    </div>
                    <div className="space-y-1.5">
                      {[
                        { icon: "🍽️", text: pt ? "Reserva no Le Jules Verne — 19h30, dia 16" : "Le Jules Verne reservation — 7:30pm, July 16" },
                        { icon: "🎫", text: pt ? "Ingresso Louvre online — já comprado!" : "Louvre ticket online — already bought!" },
                        { icon: "📱", text: pt ? "Chip de internet: Airalo eSIM Europa" : "Data plan: Airalo eSIM Europe" },
                        { icon: "💊", text: pt ? "Levar remédio de enjoo pro voo" : "Bring motion sickness pills for flight" },
                      ].map((note, i) => (
                        <div key={i} className="flex items-start gap-2 bg-violet-50 rounded-lg px-2.5 py-1.5">
                          <span className="text-xs flex-shrink-0">{note.icon}</span>
                          <span className="text-[10px] text-violet-800">{note.text}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Text */}
            <div className="w-full lg:w-1/2">
              <div className="inline-flex items-center gap-2 bg-blue-600 text-white text-xs font-bold px-3 py-1.5 rounded-full mb-4">
                <span className="text-sm">✈️</span>
                {pt ? "PASSO 08" : "STEP 08"}
              </div>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4 leading-tight">
                {pt
                  ? <>Voos, hotel e notas — <span className="text-blue-600">tudo num lugar só</span></>
                  : <>Flights, hotel and notes — <span className="text-blue-600">all in one place</span></>}
              </h2>
              <p className="text-gray-500 text-lg leading-relaxed mb-6">
                {pt
                  ? "Chega de ficar procurando o email de confirmação do voo ou o endereço do hotel. Adicione tudo no mesmo lugar do roteiro: voos com número, horário e assentos, hotel com datas e endereço, e notas como \"reserva no restaurante às 19h30\" ou \"comprar ingresso do museu online\"."
                  : "No more searching for flight confirmation emails or hotel addresses. Add everything in the same place as your itinerary: flights with number, time and seats, hotel with dates and address, and notes like \"restaurant reservation at 7:30pm\" or \"buy museum tickets online\"."}
              </p>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2 text-gray-600">
                  <span className="text-blue-500">✓</span>
                  {pt ? "Voos estilo cartão de embarque — bonito e prático" : "Flights in boarding pass style — beautiful and practical"}
                </div>
                <div className="flex items-center gap-2 text-gray-600">
                  <span className="text-blue-500">✓</span>
                  {pt ? "Hotel aparece no mapa com pin roxo" : "Hotel appears on map with purple pin"}
                </div>
                <div className="flex items-center gap-2 text-gray-600">
                  <span className="text-blue-500">✓</span>
                  {pt ? "Notas para reservas, lembretes, listas" : "Notes for reservations, reminders, lists"}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          STEP 9 — SHARE & PDF
      ═══════════════════════════════════════════════════════════════ */}
      <section id="share" className="py-20 px-6 scroll-mt-24">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col lg:flex-row items-center gap-12 lg:gap-16">
            {/* Mockup */}
            <div className="w-full lg:w-1/2">
              <div className="bg-gradient-to-br from-violet-50 to-indigo-50 rounded-3xl p-6 sm:p-8 relative overflow-hidden">
                <div className="absolute -bottom-8 -right-8 w-36 h-36 rounded-full bg-white/10" />

                <div className="space-y-3 relative z-10">
                  {/* PDF preview */}
                  <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
                    <div className="bg-gradient-to-r from-coral-500 via-coral-600 to-violet-500 px-5 py-4 text-center">
                      <div className="text-white text-base font-black">{pt ? "Paris em 5 Dias" : "Paris in 5 Days"}</div>
                      <div className="text-white/60 text-[10px]">Paris, France</div>
                      <div className="flex justify-center gap-6 mt-2">
                        <div className="text-center">
                          <div className="text-white text-lg font-bold">5</div>
                          <div className="text-white/50 text-[8px]">{pt ? "DIAS" : "DAYS"}</div>
                        </div>
                        <div className="text-center">
                          <div className="text-white text-lg font-bold">32</div>
                          <div className="text-white/50 text-[8px]">{pt ? "LUGARES" : "PLACES"}</div>
                        </div>
                        <div className="text-center">
                          <div className="text-white text-lg font-bold">2</div>
                          <div className="text-white/50 text-[8px]">{pt ? "VOOS" : "FLIGHTS"}</div>
                        </div>
                      </div>
                    </div>
                    <div className="p-4 space-y-2">
                      {[
                        { emoji: "☕", name: "Café des Deux Moulins", desc: pt ? "O café do Amélie — peça o crème brûlée" : "The Amélie café — order the crème brûlée", dur: "~45 min" },
                        { emoji: "⛪", name: "Sacré-Cœur", desc: pt ? "Suba pela escada — vista incrível grátis" : "Climb the stairs — incredible free view", dur: "~1h" },
                      ].map((item, i) => (
                        <div key={i} className="flex items-start gap-2 border-b border-gray-100 pb-2 last:border-0 last:pb-0">
                          <span className="text-sm">{item.emoji}</span>
                          <div className="flex-1">
                            <div className="text-[11px] font-bold text-gray-900">{item.name} <span className="text-gray-400 font-normal">{item.dur}</span></div>
                            <div className="text-[9px] text-gray-500">{item.desc}</div>
                          </div>
                        </div>
                      ))}
                      <div className="text-[9px] text-gray-400 text-center pt-1">+ 30 {pt ? "lugares com dicas e detalhes..." : "places with tips and details..."}</div>
                    </div>
                  </div>

                  {/* Share options */}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-emerald-500 text-white rounded-xl p-3 text-center shadow-sm">
                      <div className="text-xl mb-0.5">💬</div>
                      <div className="text-[9px] font-bold">WhatsApp</div>
                    </div>
                    <div className="bg-blue-500 text-white rounded-xl p-3 text-center shadow-sm">
                      <div className="text-xl mb-0.5">📧</div>
                      <div className="text-[9px] font-bold">Email</div>
                    </div>
                    <div className="bg-gray-800 text-white rounded-xl p-3 text-center shadow-sm">
                      <div className="text-xl mb-0.5">🔗</div>
                      <div className="text-[9px] font-bold">{pt ? "Copiar link" : "Copy link"}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Text */}
            <div className="w-full lg:w-1/2">
              <div className="inline-flex items-center gap-2 bg-violet-600 text-white text-xs font-bold px-3 py-1.5 rounded-full mb-4">
                <span className="text-sm">📤</span>
                {pt ? "PASSO 09" : "STEP 09"}
              </div>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4 leading-tight">
                {pt
                  ? <>Salve em PDF ou <span className="text-violet-600">mande pro grupo</span> do WhatsApp</>
                  : <>Save as PDF or <span className="text-violet-600">send to the group</span> chat</>}
              </h2>
              <p className="text-gray-500 text-lg leading-relaxed mb-6">
                {pt
                  ? "Exporte o roteiro completo como PDF profissional — com todas as descrições, dicas, avaliações e endereços. Perfeito pra levar no avião sem internet. Ou mande o link pelo WhatsApp pro grupo de amigos que vai junto. Todo mundo na mesma página, sem ficar mandando print de planilha."
                  : "Export the complete itinerary as a professional PDF — with all descriptions, tips, ratings and addresses. Perfect for the plane without internet. Or send the link via WhatsApp to the friends group going with you. Everyone on the same page, no more sharing spreadsheet screenshots."}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ FINAL CTA ═══ */}
      <section className="py-20 px-6 bg-gray-50">
        <div className="max-w-4xl mx-auto">
          <div className="bg-gradient-to-br from-coral-500 via-coral-600 to-violet-600 rounded-3xl p-10 sm:p-14 text-center relative overflow-hidden">
            <div className="absolute -top-16 -right-16 w-48 h-48 rounded-full bg-white/10" />
            <div className="absolute -bottom-12 -left-12 w-40 h-40 rounded-full bg-white/10" />

            <div className="relative z-10">
              <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center mx-auto mb-6">
                <div className="w-11 h-11 rounded-full bg-white flex items-center justify-center">
                  <Logo size={24} />
                </div>
              </div>

              <h2 className="text-3xl sm:text-4xl font-extrabold text-white mb-4 leading-tight">
                {pt
                  ? "Chega de perder horas planejando viagem"
                  : "Stop wasting hours planning trips"}
              </h2>
              <p className="text-white/80 text-lg mb-10 max-w-xl mx-auto leading-relaxed">
                {pt
                  ? "Cole o link daquele vídeo que você salvou e tenha um roteiro profissional em 30 segundos. Primeiro roteiro grátis."
                  : "Paste the link from that video you saved and get a professional itinerary in 30 seconds. First itinerary free."}
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Link
                  to={ctaLink}
                  className="bg-white text-coral-600 font-bold px-10 py-4 rounded-full text-base transition-all hover:shadow-xl hover:shadow-black/20 hover:scale-105"
                >
                  {pt ? "Começar agora — é grátis" : "Start now — it's free"}
                </Link>
              </div>
              <p className="text-white/50 text-sm mt-5">
                {pt ? "Sem cartão de crédito • Primeiro roteiro grátis" : "No credit card • First itinerary free"}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ FOOTER ═══ */}
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
                <Link to="/features" className="block text-sm hover:text-white transition-colors">
                  {pt ? "Como funciona" : "How it works"}
                </Link>
                <Link to="/pricing" className="block text-sm hover:text-white transition-colors">
                  {t("nav.pricing")}
                </Link>
              </div>
            </div>
            <div>
              <h4 className="text-white font-semibold text-sm mb-4">{pt ? "Conta" : "Account"}</h4>
              <div className="space-y-2.5">
                {user ? (
                  <>
                    <Link to="/dashboard" className="block text-sm hover:text-white transition-colors">{t("nav.myTrips")}</Link>
                    <Link to="/dashboard?new=1" className="block text-sm hover:text-white transition-colors">{pt ? "Nova viagem" : "New trip"}</Link>
                  </>
                ) : (
                  <>
                    <Link to="/login" className="block text-sm hover:text-white transition-colors">{t("auth.login")}</Link>
                    <Link to="/login" className="block text-sm hover:text-white transition-colors">{t("auth.register")}</Link>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="border-t border-gray-800 pt-8 flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-sm text-gray-500">{t("landing.footerCopy")}</p>
            <button onClick={toggle} className="text-sm hover:text-white transition-colors">
              {pt ? "English" : "Português"}
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
