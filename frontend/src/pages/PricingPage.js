import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useLanguage } from "../i18n/LanguageContext";
import { useAuth } from "../auth/AuthContext";
import Logo from "../components/layout/Logo";

/* ── Countdown timer ── */
function useCountdown(targetDate) {
  const [timeLeft, setTimeLeft] = useState(() => calcTimeLeft(targetDate));
  useEffect(() => {
    const timer = setInterval(() => setTimeLeft(calcTimeLeft(targetDate)), 1000);
    return () => clearInterval(timer);
  }, [targetDate]);
  return timeLeft;
}

function calcTimeLeft(targetDate) {
  const diff = new Date(targetDate) - new Date();
  if (diff <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0 };
  return {
    days: Math.floor(diff / (1000 * 60 * 60 * 24)),
    hours: Math.floor((diff / (1000 * 60 * 60)) % 24),
    minutes: Math.floor((diff / 1000 / 60) % 60),
    seconds: Math.floor((diff / 1000) % 60),
  };
}

function getPromoEndDate() {
  const key = "voyara_promo_end";
  let stored = localStorage.getItem(key);
  if (!stored) {
    const end = new Date();
    end.setDate(end.getDate() + 14);
    stored = end.toISOString();
    localStorage.setItem(key, stored);
  }
  return stored;
}

/* ── FAQ ── */
const FAQ_EN = [
  { q: "What's included in the free itinerary?", a: "You create your first complete itinerary at no cost — perfect for testing with a weekend trip or a short getaway. No credit card, no commitment. You see the quality before investing." },
  { q: "Why R$ 29.90 per itinerary?", a: "You spend R$ 5,000 to R$ 15,000 on a trip. R$ 29.90 is less than 0.5% of that — and it guarantees every day is optimized, every place is validated, and you don't miss anything important. It costs less than lunch at your destination." },
  { q: "What's the 3-pack?", a: "3 complete itineraries for R$ 69.90 (R$ 23.30 each). Perfect for couples planning together, group trips, or if you're comparing destinations." },
  { q: "What payment methods do you accept?", a: "PIX, credit card (up to 12x installments), and boleto. All prices in BRL, no hidden fees." },
  { q: "Can I edit the itinerary after?", a: "Yes. Drag to reorder, add or remove places, and ask AI to refine specific days until it's perfect. The itinerary is yours." },
  { q: "Who is the Professional plan for?", a: "Travel agents, travel bloggers, and content creators who need to generate itineraries for clients or content regularly. Includes sharing via link and white-label PDF export." },
];

const FAQ_PT = [
  { q: "O que está incluso no roteiro grátis?", a: "Você cria seu primeiro roteiro completo sem pagar nada — perfeito pra testar com um fim de semana ou uma viagem curta. Sem cartão, sem compromisso. Você vê a qualidade antes de investir." },
  { q: "Por que R$ 29,90 por roteiro?", a: "Você gasta de R$ 5.000 a R$ 15.000 numa viagem. R$ 29,90 é menos de 0,5% disso — e garante que cada dia seja otimizado, cada lugar validado, e você não perca nada importante. Custa menos que um almoço no destino." },
  { q: "O que é o pacote de 3?", a: "3 roteiros completos por R$ 69,90 (R$ 23,30 cada). Perfeito pra casais planejando juntos, viagens em grupo, ou se você está comparando destinos." },
  { q: "Quais formas de pagamento?", a: "PIX, cartão de crédito (em até 12x), e boleto. Todos os preços em reais, sem taxas escondidas." },
  { q: "Posso editar o roteiro depois?", a: "Sim. Arraste pra reordenar, adicione ou remova lugares, e peça pra IA refinar dias específicos até ficar perfeito. O roteiro é seu." },
  { q: "Pra quem é o plano Profissional?", a: "Agentes de viagem, blogueiros e criadores de conteúdo que precisam gerar roteiros para clientes ou conteúdo regularmente. Inclui compartilhamento via link e exportação PDF com sua marca." },
];

export default function PricingPage() {
  const { t, toggle, lang } = useLanguage();
  const { user } = useAuth();
  const pt = lang === "pt-BR";
  const promoEnd = getPromoEndDate();
  const countdown = useCountdown(promoEnd);
  const promoActive = countdown.days > 0 || countdown.hours > 0 || countdown.minutes > 0 || countdown.seconds > 0;
  const [openFaq, setOpenFaq] = useState(null);
  const ctaLink = user ? "/dashboard?new=1" : "/login";
  const faqData = pt ? FAQ_PT : FAQ_EN;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* ═══ NAV ═══ */}
      <nav className="fixed top-0 left-0 right-0 bg-gray-950/90 backdrop-blur-md z-50 border-b border-white/5">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
            <Logo size={30} />
            <span className="text-xl font-bold text-white tracking-tight">Voyara</span>
          </Link>
          <div className="flex items-center gap-4">
            <Link to="/" className="text-sm text-gray-400 hover:text-white transition-colors hidden sm:block">
              {t("nav.home")}
            </Link>
            <button onClick={toggle} className="text-sm text-gray-500 hover:text-white transition-colors">
              {pt ? "EN" : "PT"}
            </button>
            {user ? (
              <Link to="/dashboard" className="text-sm text-gray-300 hover:text-white font-medium transition-colors">
                {t("nav.myTrips")}
              </Link>
            ) : (
              <Link to="/login" className="bg-white text-gray-900 text-sm font-semibold px-5 py-2 rounded-full transition-colors hover:bg-gray-100">
                {pt ? "Entrar" : "Log in"}
              </Link>
            )}
          </div>
        </div>
      </nav>

      {/* ═══ PROMO BANNER ═══ */}
      {promoActive && (
        <div className="fixed top-[53px] left-0 right-0 bg-coral-600 text-white z-40 py-2 px-4">
          <div className="max-w-6xl mx-auto flex items-center justify-center gap-4 text-sm font-medium">
            <span className="hidden sm:inline font-bold tracking-wide">
              {pt ? "PREÇO DE LANÇAMENTO" : "LAUNCH PRICING"}
            </span>
            <span className="text-white/80">—</span>
            <span className="text-white/90">
              {pt ? "Oferta acaba em" : "Offer ends in"}
            </span>
            <div className="flex items-center gap-1 font-mono font-bold tracking-wider">
              <span className="bg-black/20 rounded px-1.5 py-0.5">{String(countdown.days).padStart(2, "0")}d</span>
              <span className="text-white/50">:</span>
              <span className="bg-black/20 rounded px-1.5 py-0.5">{String(countdown.hours).padStart(2, "0")}h</span>
              <span className="text-white/50">:</span>
              <span className="bg-black/20 rounded px-1.5 py-0.5">{String(countdown.minutes).padStart(2, "0")}m</span>
              <span className="text-white/50">:</span>
              <span className="bg-black/20 rounded px-1.5 py-0.5">{String(countdown.seconds).padStart(2, "0")}s</span>
            </div>
          </div>
        </div>
      )}

      {/* ═══ HERO ═══ */}
      <section className={`${promoActive ? "pt-36" : "pt-28"} pb-16 px-6`}>
        <div className="max-w-3xl mx-auto text-center">
          <p className="text-coral-400 text-sm font-semibold tracking-widest uppercase mb-6">
            {pt ? "Planos e preços" : "Plans & Pricing"}
          </p>
          <h1 className="text-4xl sm:text-5xl font-extrabold text-white leading-[1.1] tracking-tight mb-6">
            {pt
              ? "Quanto vale nunca mais perder tempo planejando viagem?"
              : "How much is it worth to never waste time planning a trip again?"}
          </h1>
          <p className="text-lg text-gray-400 max-w-2xl mx-auto leading-relaxed mb-3">
            {pt
              ? "Você gasta R$ 5.000 a R$ 15.000 numa viagem. O Voyara garante que cada real seja bem aproveitado — por menos do que você paga num almoço."
              : "You spend R$ 5,000 to R$ 15,000 on a trip. Voyara makes sure every cent is well spent — for less than you pay for lunch."}
          </p>
          <p className="text-sm text-gray-600">
            {pt
              ? "Comece grátis — seu primeiro roteiro é por nossa conta."
              : "Start free — your first itinerary is on us."}
          </p>
        </div>
      </section>

      {/* ═══ PRICING CARDS ═══ */}
      <section className="pb-20 px-4 sm:px-6">
        <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* ─── FREE TRIAL ─── */}
          <div className="bg-gray-900 rounded-2xl border border-white/10 p-7 flex flex-col hover:border-white/20 transition-colors">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-4">
              {pt ? "Primeiro roteiro" : "First itinerary"}
            </p>

            <div className="mb-6">
              <span className="text-5xl font-extrabold text-white">R$ 0</span>
            </div>

            <p className="text-sm text-gray-500 mb-6">
              {pt ? "Seu primeiro roteiro é por nossa conta." : "Your first itinerary is on us."}
            </p>

            <ul className="space-y-3 mb-8 flex-1">
              {(pt
                ? ["Roteiro completo com mapa", "Lugares validados no Google Maps", "Perfeito pra um fim de semana", "Veja a qualidade antes de investir"]
                : ["Full itinerary with map", "Places validated on Google Maps", "Perfect for a weekend trip", "See the quality before investing"]
              ).map((item, i) => (
                <li key={i} className="flex items-start gap-3 text-sm text-gray-400">
                  <svg className="w-4 h-4 mt-0.5 text-gray-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                  {item}
                </li>
              ))}
            </ul>

            <Link to={ctaLink} className="block text-center border border-white/20 hover:border-white/40 text-white font-semibold py-3 rounded-xl transition-colors text-sm">
              {pt ? "Testar grátis" : "Try free"}
            </Link>
          </div>

          {/* ─── ROTEIRO COMPLETO (highlight) ─── */}
          <div className="bg-gray-900 rounded-2xl border-2 border-coral-500/50 p-7 flex flex-col relative shadow-lg shadow-coral-500/5">
            <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
              <div className="bg-coral-500 text-white text-xs font-bold px-5 py-1.5 rounded-full tracking-wide">
                {pt ? "MAIS POPULAR" : "MOST POPULAR"}
              </div>
            </div>

            <p className="text-xs font-semibold text-coral-400 uppercase tracking-widest mb-4 mt-1">
              {pt ? "Roteiro Completo" : "Full Itinerary"}
            </p>

            <div className="mb-2">
              {promoActive && (
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="text-sm text-gray-600 line-through">R$ 39,90</span>
                  <span className="text-coral-400 text-xs font-bold">
                    {pt ? "LANÇAMENTO" : "LAUNCH"}
                  </span>
                </div>
              )}
              <span className="text-5xl font-extrabold text-white">R$ 29</span>
              <span className="text-2xl font-bold text-white">,90</span>
              <span className="text-gray-500 text-sm ml-2">/{pt ? "roteiro" : "itinerary"}</span>
            </div>
            <p className="text-xs text-gray-600 mb-6">
              {pt ? "Menos de 0,5% do custo da sua viagem" : "Less than 0.5% of your trip cost"}
            </p>

            <ul className="space-y-3 mb-8 flex-1">
              {(pt
                ? [
                    "Roteiro completo, sem limite de dias",
                    "Mapa interativo com rota por dia",
                    "Fotos, avaliações e horários reais",
                    "Timing estratégico (pôr do sol, manhã)",
                    "Refinar com IA até ficar perfeito",
                    "Sugestões de lugares escondidos",
                    "Aba de voos e notas",
                  ]
                : [
                    "Full itinerary, unlimited days",
                    "Interactive map with daily routes",
                    "Real photos, ratings and hours",
                    "Strategic timing (sunset, morning)",
                    "Refine with AI until perfect",
                    "Hidden gem suggestions",
                    "Flights & notes tab",
                  ]
              ).map((item, i) => (
                <li key={i} className="flex items-start gap-3 text-sm text-gray-300">
                  <svg className="w-4 h-4 mt-0.5 text-coral-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                  {item}
                </li>
              ))}
            </ul>

            <Link to={ctaLink} className="block text-center bg-coral-500 hover:bg-coral-600 text-white font-bold py-3.5 rounded-xl transition-colors text-sm">
              {pt ? "Criar meu roteiro" : "Build my itinerary"}
            </Link>

            {/* Pacote 3 */}
            <div className="mt-5 border border-white/10 rounded-xl p-4">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider">
                  {pt ? "Pacote 3 roteiros" : "3-pack"}
                </p>
                <span className="text-xs text-emerald-400 font-bold">-22%</span>
              </div>
              <p className="text-white font-bold">
                R$ 69,90 <span className="text-gray-500 font-normal text-sm">({pt ? "R$ 23,30 cada" : "R$ 23.30 each"})</span>
              </p>
              <p className="text-xs text-gray-600 mt-1">
                {pt ? "Ideal pra casal, grupo ou comparar destinos" : "Ideal for couples, groups, or comparing destinations"}
              </p>
            </div>
          </div>

          {/* ─── PROFISSIONAL ─── */}
          <div className="bg-gray-900 rounded-2xl border border-violet-500/30 p-7 flex flex-col relative hover:border-violet-500/50 transition-colors">
            <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
              <div className="bg-violet-600 text-white text-xs font-bold px-5 py-1.5 rounded-full tracking-wide">
                PRO
              </div>
            </div>

            <p className="text-xs font-semibold text-violet-400 uppercase tracking-widest mb-4 mt-1">
              {pt ? "Profissional" : "Professional"}
            </p>

            <div className="mb-2">
              {promoActive && (
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="text-sm text-gray-600 line-through">R$ 249,90</span>
                  <span className="text-violet-400 text-xs font-bold">-20%</span>
                </div>
              )}
              <span className="text-5xl font-extrabold text-white">R$ 199</span>
              <span className="text-2xl font-bold text-white">,90</span>
              <span className="text-gray-500 text-sm ml-2">/{pt ? "mês" : "mo"}</span>
            </div>
            <p className="text-xs text-gray-600 mb-6">
              {pt ? "Até 30 roteiros por mês" : "Up to 30 itineraries per month"}
            </p>

            <ul className="space-y-3 mb-8 flex-1">
              {(pt
                ? [
                    "Tudo do Roteiro Completo",
                    "30 roteiros por mês",
                    "Prioridade na fila de geração",
                    "Compartilhe roteiros via link",
                    "PDF com sua marca (white-label)",
                    "Suporte VIP",
                  ]
                : [
                    "Everything in Full Itinerary",
                    "30 itineraries per month",
                    "Priority generation queue",
                    "Share itineraries via link",
                    "White-label PDF with your brand",
                    "VIP support",
                  ]
              ).map((item, i) => (
                <li key={i} className="flex items-start gap-3 text-sm text-gray-300">
                  <svg className="w-4 h-4 mt-0.5 text-violet-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                  {item}
                </li>
              ))}
            </ul>

            <Link to={ctaLink} className="block text-center bg-violet-600 hover:bg-violet-700 text-white font-bold py-3.5 rounded-xl transition-colors text-sm">
              {pt ? "Começar agora" : "Get started"}
            </Link>

            <div className="mt-5 border border-white/10 rounded-xl p-4">
              <p className="text-xs text-gray-500 text-center">
                {pt ? "Precisa de mais? Roteiros extras por R$ 9,90 cada." : "Need more? Extra itineraries at R$ 9.90 each."}
              </p>
            </div>
          </div>
        </div>

        {/* Guarantee */}
        <div className="max-w-md mx-auto mt-12 text-center">
          <div className="border border-white/10 rounded-xl px-6 py-4 bg-gray-900/50">
            <p className="text-sm font-semibold text-white mb-1">
              {pt ? "Garantia de 7 dias" : "7-day guarantee"}
            </p>
            <p className="text-xs text-gray-500">
              {pt
                ? "Não ficou satisfeito? Devolvemos 100% do valor. Sem perguntas."
                : "Not satisfied? Full refund, no questions asked."}
            </p>
          </div>
        </div>
      </section>

      {/* ═══ COMPARISON TABLE ═══ */}
      <section className="py-16 px-4 sm:px-6 border-t border-white/5">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold text-white text-center mb-10">
            {pt ? "Compare os planos" : "Compare plans"}
          </h2>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left py-3 pr-4 text-gray-500 font-medium">{pt ? "Recurso" : "Feature"}</th>
                  <th className="text-center py-3 px-3 text-gray-400 font-semibold">{pt ? "Grátis" : "Free"}</th>
                  <th className="text-center py-3 px-3 text-coral-400 font-semibold">{pt ? "Completo" : "Full"}</th>
                  <th className="text-center py-3 px-3 text-violet-400 font-semibold">Pro</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {[
                  { feature: pt ? "Roteiros" : "Itineraries", free: "1", full: pt ? "Por compra" : "Per purchase", pro: "30/" + (pt ? "mês" : "mo") },
                  { feature: pt ? "Dias por roteiro" : "Days per itinerary", free: pt ? "Até 3" : "Up to 3", full: pt ? "Sem limite" : "Unlimited", pro: pt ? "Sem limite" : "Unlimited" },
                  { feature: pt ? "Mapa interativo" : "Interactive map", free: "✓", full: "✓", pro: "✓" },
                  { feature: "Google Maps", free: "✓", full: "✓", pro: "✓" },
                  { feature: pt ? "Timing estratégico" : "Strategic timing", free: pt ? "Básico" : "Basic", full: "✓", pro: "✓" },
                  { feature: pt ? "Refinar com IA" : "AI refinement", free: "—", full: "✓", pro: "✓" },
                  { feature: pt ? "Lugares escondidos" : "Hidden gems", free: "—", full: "✓", pro: "✓" },
                  { feature: pt ? "Voos e notas" : "Flights & notes", free: "—", full: "✓", pro: "✓" },
                  { feature: pt ? "Prioridade na fila" : "Priority queue", free: "—", full: "—", pro: "✓" },
                  { feature: pt ? "Compartilhar via link" : "Share via link", free: "—", full: "—", pro: "✓" },
                  { feature: "White-label PDF", free: "—", full: "—", pro: "✓" },
                  { feature: pt ? "Suporte" : "Support", free: "—", full: "Email", pro: "VIP" },
                ].map((row, i) => (
                  <tr key={i}>
                    <td className="py-3 pr-4 text-gray-400">{row.feature}</td>
                    <td className="py-3 px-3 text-center text-gray-600">{row.free}</td>
                    <td className="py-3 px-3 text-center text-gray-300">{row.full}</td>
                    <td className="py-3 px-3 text-center text-gray-300">{row.pro}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ═══ SOCIAL PROOF ═══ */}
      <section className="py-16 px-6 border-t border-white/5">
        <div className="max-w-3xl mx-auto text-center">
          <div className="flex items-center justify-center gap-0.5 mb-4">
            {[1,2,3,4,5].map(i => (
              <svg key={i} className="w-5 h-5 text-amber-400" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" /></svg>
            ))}
          </div>
          <p className="text-white font-medium mb-6">
            {pt ? "4.9/5 — Avaliado por viajantes reais" : "4.9/5 — Rated by real travelers"}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { text: pt ? "Planejei minha lua de mel em 10 minutos." : "Planned my honeymoon in 10 minutes.", name: "Marcos L." },
              { text: pt ? "Substituiu 3 apps que eu usava." : "Replaced 3 apps I was using.", name: "Camila F." },
              { text: pt ? "Roteiro melhor do que agência de viagem." : "Better itinerary than a travel agency.", name: "Pedro O." },
            ].map((item, i) => (
              <div key={i} className="bg-gray-900 border border-white/5 rounded-xl p-5">
                <p className="text-sm text-gray-400 mb-3 italic">"{item.text}"</p>
                <p className="text-xs text-gray-600">— {item.name}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ FAQ ═══ */}
      <section className="py-16 px-6 border-t border-white/5">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-2xl font-bold text-white text-center mb-10">
            {pt ? "Perguntas frequentes" : "Frequently asked questions"}
          </h2>

          <div className="space-y-2">
            {faqData.map((item, i) => (
              <div key={i} className="bg-gray-900 border border-white/5 rounded-xl overflow-hidden">
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="flex items-center justify-between w-full px-6 py-4 text-left hover:bg-white/5 transition-colors"
                >
                  <span className="text-sm font-semibold text-white pr-4">{item.q}</span>
                  <svg className={`w-4 h-4 text-gray-500 transition-transform flex-shrink-0 ${openFaq === i ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {openFaq === i && (
                  <div className="px-6 pb-4">
                    <p className="text-sm text-gray-500 leading-relaxed">{item.a}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ FINAL CTA ═══ */}
      <section className="py-20 px-6 border-t border-white/5">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl font-extrabold text-white mb-4">
            {pt
              ? "Sua viagem merece mais do que uma planilha"
              : "Your trip deserves more than a spreadsheet"}
          </h2>
          <p className="text-gray-500 mb-8 max-w-lg mx-auto">
            {pt
              ? "Teste grátis. Veja a qualidade. Depois decida."
              : "Try free. See the quality. Then decide."}
          </p>
          <Link to={ctaLink} className="inline-block bg-coral-500 hover:bg-coral-600 text-white font-bold px-10 py-4 rounded-full text-base transition-colors">
            {pt ? "Começar grátis" : "Start free"}
          </Link>
          <p className="text-gray-700 text-xs mt-4">
            {pt ? "Sem cartão de crédito necessário" : "No credit card required"}
          </p>
        </div>
      </section>

      {/* ═══ FOOTER ═══ */}
      <footer className="border-t border-white/5 py-10 px-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <Logo size={22} />
            <span className="text-white text-sm font-bold">Voyara</span>
          </div>
          <div className="flex items-center gap-6 text-xs text-gray-600">
            <Link to="/" className="hover:text-gray-400 transition-colors">{t("nav.home")}</Link>
            <Link to="/dashboard" className="hover:text-gray-400 transition-colors">{t("nav.myTrips")}</Link>
            <button onClick={toggle} className="hover:text-gray-400 transition-colors">{pt ? "English" : "Português"}</button>
          </div>
        </div>
      </footer>
    </div>
  );
}
