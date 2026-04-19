import { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";

// Airplane at sunset — Unsplash, free, high-res
const HERO_IMG =
  "https://images.unsplash.com/photo-1544016768-982d1554f0b5?w=2400&q=85&auto=format&fit=crop";

// Small decorative floating items
const FLOAT_ICONS = [
  { emoji: "📍", x: "8%", y: "18%", delay: 0, size: 52 },
  { emoji: "✈️", x: "85%", y: "22%", delay: 0.3, size: 56 },
  { emoji: "🗺️", x: "12%", y: "68%", delay: 0.6, size: 48 },
  { emoji: "📸", x: "82%", y: "72%", delay: 0.9, size: 48 },
];

export default function CinematicHero({ pt, ctaLink, user }) {
  const [email, setEmail] = useState("");

  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
      {/* Background image */}
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{
          backgroundImage: `url('${HERO_IMG}')`,
          backgroundPosition: "center 40%",
        }}
      />

      {/* Dark gradient overlay for text legibility */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-black/35 to-black/70" />

      {/* Subtle emerald wash for brand cohesion */}
      <div
        className="absolute inset-0 mix-blend-color opacity-25"
        style={{
          background:
            "linear-gradient(135deg, rgba(16,185,129,0.25) 0%, rgba(5,150,105,0) 55%, rgba(16,185,129,0.15) 100%)",
        }}
      />

      {/* Floating emoji icons */}
      {FLOAT_ICONS.map((ic, i) => (
        <motion.div
          key={i}
          className="absolute pointer-events-none select-none"
          style={{
            left: ic.x,
            top: ic.y,
            fontSize: ic.size,
            filter: "drop-shadow(0 8px 24px rgba(0,0,0,0.35))",
          }}
          initial={{ opacity: 0, y: 20 }}
          animate={{
            opacity: 1,
            y: [0, -14, 0],
          }}
          transition={{
            opacity: { duration: 1.2, delay: ic.delay },
            y: {
              duration: 4 + i * 0.4,
              delay: ic.delay,
              repeat: Infinity,
              ease: "easeInOut",
            },
          }}
        >
          <span>{ic.emoji}</span>
        </motion.div>
      ))}

      {/* Content */}
      <div className="relative z-10 max-w-4xl mx-auto px-6 text-center text-white">
        {/* Logo pill */}
        <motion.div
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="inline-flex items-center gap-2 bg-white/15 backdrop-blur-md border border-white/25 px-5 py-2 rounded-full mb-8"
        >
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-sm font-semibold tracking-wide">
            {pt
              ? "Seu primeiro roteiro é grátis"
              : "Your first itinerary is free"}
          </span>
        </motion.div>

        {/* Headline */}
        <motion.h1
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.1 }}
          className="text-5xl sm:text-6xl lg:text-7xl font-extrabold leading-[1.05] tracking-tight mb-6"
          style={{ textShadow: "0 4px 30px rgba(0,0,0,0.45)" }}
        >
          {pt ? (
            <>
              Pare de planejar.
              <br />
              <span className="bg-gradient-to-r from-emerald-300 via-emerald-200 to-white bg-clip-text text-transparent">
                Comece a viajar.
              </span>
            </>
          ) : (
            <>
              Stop planning.
              <br />
              <span className="bg-gradient-to-r from-emerald-300 via-emerald-200 to-white bg-clip-text text-transparent">
                Start traveling.
              </span>
            </>
          )}
        </motion.h1>

        {/* Subheadline */}
        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.3 }}
          className="text-lg sm:text-xl text-white/90 max-w-2xl mx-auto mb-10"
        >
          {pt
            ? "Cole um link do TikTok, Instagram ou YouTube — a IA monta seu roteiro completo em 30 segundos com mapa, horários e lugares reais."
            : "Paste a TikTok, Instagram or YouTube link — AI builds your full itinerary in 30 seconds with maps, timing and real places."}
        </motion.p>

        {/* CTAs */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.5 }}
          className="flex flex-col sm:flex-row items-center justify-center gap-4"
        >
          <Link
            to={ctaLink}
            className="group relative inline-flex items-center gap-3 bg-emerald-500 hover:bg-emerald-600 text-white font-bold px-8 py-4 rounded-full shadow-2xl shadow-emerald-900/40 transition-all hover:scale-105"
          >
            <span className="text-2xl group-hover:translate-x-0.5 transition-transform">
              ✨
            </span>
            <span className="text-base">
              {pt ? "Criar roteiro grátis" : "Create trip free"}
            </span>
          </Link>

          <Link
            to="/features"
            className="inline-flex items-center gap-2 bg-white/15 hover:bg-white/25 backdrop-blur-md border border-white/30 text-white font-semibold px-7 py-4 rounded-full transition-all"
          >
            <span>{pt ? "Como funciona" : "How it works"}</span>
            <span className="group-hover:translate-x-1 transition-transform">
              →
            </span>
          </Link>
        </motion.div>

        {/* Social proof text */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1, delay: 0.9 }}
          className="mt-10 flex items-center justify-center gap-2 text-sm text-white/70"
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
          <span>
            {pt
              ? "+2.400 viajantes já criaram seus roteiros"
              : "+2,400 travelers already built their trips"}
          </span>
        </motion.div>
      </div>

      {/* Scroll indicator */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, y: [0, 8, 0] }}
        transition={{
          opacity: { duration: 1, delay: 1.4 },
          y: { duration: 2, repeat: Infinity, ease: "easeInOut" },
        }}
        className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 text-white/70"
      >
        <svg
          width="28"
          height="28"
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
