import { useRef } from "react";
import { Link } from "react-router-dom";
import { motion, useScroll, useTransform } from "framer-motion";

/**
 * Premium travel palette:
 *   Navy       #0B2E4F   primary, trust, premium
 *   Amber      #F59E0B   sunset, energy, CTA
 *   Cream      #FAF8F3   warm background
 *   Teal       #0F766E   nature / accents
 *   Ink        #0F172A   body text
 */

// Classic airplane-window sunset over clouds (verified 200 OK)
const HERO_IMG =
  "https://images.unsplash.com/photo-1436491865332-7a61a109cc05?w=2400&q=85&auto=format&fit=crop";

// Backup if primary fails
const HERO_FALLBACK =
  "https://images.unsplash.com/photo-1488085061387-422e29b40080?w=2400&q=85&auto=format&fit=crop";

// Minimal SVG constellation dots, no emojis
const CONSTELLATION = [
  { x: "12%", y: "24%", delay: 0, size: 4 },
  { x: "88%", y: "28%", delay: 0.3, size: 5 },
  { x: "18%", y: "72%", delay: 0.6, size: 3 },
  { x: "82%", y: "68%", delay: 0.9, size: 4 },
  { x: "50%", y: "12%", delay: 1.1, size: 3 },
];

export default function CinematicHero({ pt, ctaLink, user }) {
  const sectionRef = useRef(null);
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end start"],
  });
  // Subtle parallax — not too extreme, keeps things snappy
  const imageY = useTransform(scrollYProgress, [0, 1], ["0%", "12%"]);
  const contentY = useTransform(scrollYProgress, [0, 1], ["0%", "-10%"]);
  const contentOpacity = useTransform(scrollYProgress, [0, 0.5], [1, 0]);

  return (
    <section
      ref={sectionRef}
      className="relative min-h-screen flex items-center justify-center overflow-hidden bg-[#0B2E4F]"
    >
      {/* Background image with parallax */}
      <motion.img
        src={HERO_IMG}
        onError={(e) => {
          if (e.currentTarget.src !== HERO_FALLBACK) {
            e.currentTarget.src = HERO_FALLBACK;
          }
        }}
        alt=""
        className="absolute inset-0 w-full h-[120%] object-cover object-center"
        style={{
          filter: "saturate(1.1) contrast(1.05)",
          y: imageY,
        }}
      />

      {/* Rich gradient overlay: navy bottom → warm amber top-right */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(11,46,79,0.35) 0%, rgba(11,46,79,0.55) 60%, rgba(11,46,79,0.9) 100%)",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 80% 20%, rgba(245,158,11,0.25) 0%, transparent 55%)",
        }}
      />

      {/* Film grain suggestion — subtle noise via svg filter */}
      <div
        className="absolute inset-0 opacity-[0.04] pointer-events-none mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence baseFrequency='0.9' numOctaves='2'/></filter><rect width='200' height='200' filter='url(%23n)'/></svg>\")",
        }}
      />

      {/* Constellation — subtle amber pinpoints, no emojis */}
      {CONSTELLATION.map((dot, i) => (
        <motion.div
          key={i}
          className="absolute pointer-events-none hidden md:block"
          style={{
            left: dot.x,
            top: dot.y,
            width: dot.size,
            height: dot.size,
            borderRadius: "50%",
            background: "#FBBF24",
            boxShadow:
              "0 0 18px rgba(251,191,36,0.9), 0 0 34px rgba(245,158,11,0.5)",
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: [0.4, 1, 0.4] }}
          transition={{
            duration: 3 + i * 0.3,
            delay: dot.delay,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      ))}

      {/* Content with scroll-out transform */}
      <motion.div
        className="relative z-10 max-w-4xl mx-auto px-6 text-center text-white"
        style={{
          y: contentY,
          opacity: contentOpacity,
          willChange: "transform, opacity",
        }}
      >
        {/* Logo pill */}
        <motion.div
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-xl border border-white/20 px-5 py-2 rounded-full mb-8"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
          <span className="text-xs font-semibold tracking-widest uppercase">
            {pt ? "Primeiro roteiro grátis" : "First trip free"}
          </span>
        </motion.div>

        {/* Headline */}
        <motion.h1
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
          className="font-display text-5xl sm:text-6xl lg:text-8xl font-bold leading-[0.98] tracking-[-0.035em] mb-6"
          style={{
            textShadow: "0 6px 40px rgba(0,0,0,0.55)",
          }}
        >
          {pt ? (
            <>
              Pare de planejar.
              <br />
              <span
                style={{
                  background:
                    "linear-gradient(135deg, #FBBF24 0%, #F59E0B 50%, #FCD34D 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                Comece a viajar.
              </span>
            </>
          ) : (
            <>
              Stop planning.
              <br />
              <span
                style={{
                  background:
                    "linear-gradient(135deg, #FBBF24 0%, #F59E0B 50%, #FCD34D 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                Start traveling.
              </span>
            </>
          )}
        </motion.h1>

        {/* Subheadline */}
        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="text-lg sm:text-xl text-white/85 max-w-2xl mx-auto mb-10 leading-relaxed"
        >
          {pt
            ? "Cole um link do TikTok, Instagram ou YouTube. A IA monta seu roteiro completo em 30 segundos, com mapa, horários e lugares reais."
            : "Paste a TikTok, Instagram or YouTube link. AI builds your full itinerary in 30 seconds, with maps, timing and real places."}
        </motion.p>

        {/* CTAs */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.35, ease: [0.16, 1, 0.3, 1] }}
          className="flex flex-col sm:flex-row items-center justify-center gap-3"
        >
          <Link
            to={ctaLink}
            className="group relative inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-[#0B2E4F] font-bold px-8 py-4 rounded-full shadow-2xl transition-all hover:scale-[1.03]"
            style={{
              boxShadow:
                "0 20px 45px -12px rgba(245,158,11,0.55), 0 0 0 1px rgba(251,191,36,0.3)",
            }}
          >
            <span className="text-base tracking-wide">
              {pt ? "Criar roteiro grátis" : "Create trip free"}
            </span>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="group-hover:translate-x-1 transition-transform"
            >
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </Link>

          <Link
            to="/features"
            className="inline-flex items-center gap-2 bg-white/5 hover:bg-white/10 backdrop-blur-xl border border-white/25 text-white font-semibold px-7 py-4 rounded-full transition-all"
          >
            <span>{pt ? "Como funciona" : "How it works"}</span>
          </Link>
        </motion.div>

        {/* Social proof */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1, delay: 0.9 }}
          className="mt-12 flex items-center justify-center gap-3 text-sm text-white/70"
        >
          <div className="flex -space-x-2">
            {[5, 11, 23, 53].map((id) => (
              <img
                key={id}
                src={`https://i.pravatar.cc/40?img=${id}`}
                alt=""
                className="w-8 h-8 rounded-full border-2 border-white/90 object-cover"
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex text-amber-400">
              {[0, 1, 2, 3, 4].map((i) => (
                <svg key={i} width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              ))}
            </div>
            <span>
              {pt
                ? "+2.400 viajantes"
                : "+2,400 travelers"}
            </span>
          </div>
        </motion.div>
      </motion.div>

      {/* Scroll indicator */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.6, y: [0, 8, 0] }}
        transition={{
          opacity: { duration: 1, delay: 1.4 },
          y: { duration: 2, repeat: Infinity, ease: "easeInOut" },
        }}
        className="absolute bottom-10 left-1/2 -translate-x-1/2 z-10 text-white"
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </motion.div>
    </section>
  );
}
