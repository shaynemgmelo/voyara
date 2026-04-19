import { Link } from "react-router-dom";
import { useLanguage } from "../../i18n/LanguageContext";
import Logo from "./Logo";

export default function Footer({ variant = "default" }) {
  const { lang } = useLanguage();
  const pt = lang === "pt-BR";
  const year = new Date().getFullYear();

  const isDark = variant === "dark";

  return (
    <footer
      className={`${
        isDark ? "bg-[#0B2E4F] text-white" : "bg-[#0B2E4F] text-white"
      } mt-20`}
    >
      <div className="max-w-6xl mx-auto px-6 py-14">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10">
          {/* Brand */}
          <div className="lg:col-span-2">
            <div className="flex items-center gap-2.5 mb-4">
              <Logo size={36} variant="light" />
              <span className="font-display text-2xl font-bold tracking-tight">
                Mapass
              </span>
            </div>
            <p className="text-white/70 text-sm leading-relaxed max-w-md">
              {pt
                ? "Transforme qualquer vídeo de viagem em um roteiro completo, dia a dia, com mapa e lugares reais. A IA que planeja pelo viajante exigente."
                : "Turn any travel video into a full day-by-day itinerary with map and real places. The AI that plans for demanding travelers."}
            </p>
            <div className="mt-6 flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 bg-white/10 text-white/90 text-xs font-semibold px-3 py-1.5 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                {pt ? "Roteiro grátis no primeiro uso" : "Free first trip"}
              </span>
            </div>
          </div>

          {/* Product */}
          <div>
            <div className="text-xs font-bold tracking-[0.2em] text-white/50 uppercase mb-4">
              {pt ? "Produto" : "Product"}
            </div>
            <ul className="space-y-2.5 text-sm">
              <li>
                <Link to="/" className="text-white/80 hover:text-white transition-colors">
                  {pt ? "Início" : "Home"}
                </Link>
              </li>
              <li>
                <Link to="/features" className="text-white/80 hover:text-white transition-colors">
                  {pt ? "Como funciona" : "How it works"}
                </Link>
              </li>
              <li>
                <Link to="/pricing" className="text-white/80 hover:text-white transition-colors">
                  {pt ? "Planos" : "Pricing"}
                </Link>
              </li>
              <li>
                <Link to="/dashboard" className="text-white/80 hover:text-white transition-colors">
                  {pt ? "Meus roteiros" : "My trips"}
                </Link>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <div className="text-xs font-bold tracking-[0.2em] text-white/50 uppercase mb-4">
              {pt ? "Empresa" : "Company"}
            </div>
            <ul className="space-y-2.5 text-sm">
              <li>
                <Link to="/privacy" className="text-white/80 hover:text-white transition-colors">
                  {pt ? "Privacidade" : "Privacy"}
                </Link>
              </li>
              <li>
                <Link to="/terms" className="text-white/80 hover:text-white transition-colors">
                  {pt ? "Termos de uso" : "Terms"}
                </Link>
              </li>
              <li>
                <a
                  href="mailto:suporte@mapass.app"
                  className="text-white/80 hover:text-white transition-colors"
                >
                  {pt ? "Suporte" : "Support"}
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Divider + bottom */}
        <div className="mt-12 pt-6 border-t border-white/10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-white/50">
          <div>
            © {year} Mapass.{" "}
            {pt ? "Feito para quem viaja de verdade." : "Made for real travelers."}
          </div>
          <div className="flex items-center gap-3">
            <span>🇧🇷 {pt ? "Do Brasil para o mundo" : "From Brazil to the world"}</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
