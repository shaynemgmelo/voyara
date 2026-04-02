import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { useLanguage } from "../../i18n/LanguageContext";

/*
 * Destination Preview Modal — shows a "spoiler" of what the itinerary
 * would look like for a given destination, with curated iconic places,
 * photos, ratings, and tips. Triggers desire and sends to trip creation.
 */

const DESTINATION_DATA = {
  Paris: {
    hero: "https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=800&h=400&fit=crop&q=80",
    tagline: { en: "The city that never stops inspiring", pt: "A cidade que nunca para de inspirar" },
    places: [
      { name: "Eiffel Tower", emoji: "🗼", rating: 4.7, reviews: "288K", photo: "https://images.unsplash.com/photo-1543349689-9a4d426bee8e?w=300&h=200&fit=crop&q=80", tip: { en: "Go at sunset for golden light", pt: "Vá no pôr do sol pela luz dourada" }, cat: "landmark" },
      { name: "Louvre Museum", emoji: "🏛️", rating: 4.7, reviews: "340K", photo: "https://images.unsplash.com/photo-1499856871958-5b9627545d1a?w=300&h=200&fit=crop&q=80", tip: { en: "Wednesday & Friday evenings are quieter", pt: "Quartas e sextas à noite são mais vazias" }, cat: "museum" },
      { name: "Montmartre", emoji: "🎨", rating: 4.6, reviews: "95K", photo: "https://images.unsplash.com/photo-1550340499-a6c60fc8287c?w=300&h=200&fit=crop&q=80", tip: { en: "Best views of Paris at sunrise", pt: "Melhor vista de Paris ao nascer do sol" }, cat: "neighborhood" },
      { name: "Seine River Cruise", emoji: "🚢", rating: 4.8, reviews: "42K", photo: "https://images.unsplash.com/photo-1478391679764-b2d8b3cd1e94?w=300&h=200&fit=crop&q=80", tip: { en: "Evening cruise with city lights", pt: "Passeio noturno com luzes da cidade" }, cat: "activity" },
      { name: "Le Marais", emoji: "🥐", rating: 4.5, reviews: "28K", photo: "https://images.unsplash.com/photo-1551218808-94e220e084d2?w=300&h=200&fit=crop&q=80", tip: { en: "Hidden cafés and vintage shops", pt: "Cafés escondidos e lojas vintage" }, cat: "gem", gem: true },
      { name: "Sacré-Cœur", emoji: "⛪", rating: 4.7, reviews: "180K", photo: "https://images.unsplash.com/photo-1568684333877-4d39f2cdd115?w=300&h=200&fit=crop&q=80", tip: { en: "Free entry, stunning panoramic view", pt: "Entrada gratuita, vista panorâmica" }, cat: "landmark" },
    ],
  },
  Tokyo: {
    hero: "https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=800&h=400&fit=crop&q=80",
    tagline: { en: "Where tradition meets the future", pt: "Onde tradição encontra o futuro" },
    places: [
      { name: "Shibuya Crossing", emoji: "🚶", rating: 4.5, reviews: "120K", photo: "https://images.unsplash.com/photo-1542051841857-5f90071e7989?w=300&h=200&fit=crop&q=80", tip: { en: "View from Starbucks above", pt: "Vista do Starbucks de cima" }, cat: "landmark" },
      { name: "Senso-ji Temple", emoji: "⛩️", rating: 4.6, reviews: "195K", photo: "https://images.unsplash.com/photo-1545569341-9eb8b30979d9?w=300&h=200&fit=crop&q=80", tip: { en: "Go early morning to avoid crowds", pt: "Vá cedo para evitar multidões" }, cat: "landmark" },
      { name: "Tsukiji Outer Market", emoji: "🍣", rating: 4.6, reviews: "85K", photo: "https://images.unsplash.com/photo-1553621042-f6e147245754?w=300&h=200&fit=crop&q=80", tip: { en: "Best sushi breakfast in the world", pt: "Melhor café da manhã de sushi do mundo" }, cat: "food" },
      { name: "Shinjuku Gyoen", emoji: "🌸", rating: 4.7, reviews: "65K", photo: "https://images.unsplash.com/photo-1522623349500-de37a56ea2a5?w=300&h=200&fit=crop&q=80", tip: { en: "Cherry blossom paradise in spring", pt: "Paraíso das cerejeiras na primavera" }, cat: "park" },
      { name: "Golden Gai", emoji: "🍶", rating: 4.4, reviews: "32K", photo: "https://images.unsplash.com/photo-1554797589-7241bb691973?w=300&h=200&fit=crop&q=80", tip: { en: "Tiny bars, big memories", pt: "Bares minúsculos, grandes memórias" }, cat: "gem", gem: true },
      { name: "TeamLab Borderless", emoji: "✨", rating: 4.8, reviews: "48K", photo: "https://images.unsplash.com/photo-1549277513-f1b32fe1f8f5?w=300&h=200&fit=crop&q=80", tip: { en: "Book tickets 2 weeks ahead", pt: "Reserve ingressos 2 semanas antes" }, cat: "activity" },
    ],
  },
  Rome: {
    hero: "https://images.unsplash.com/photo-1552832230-c0197dd311b5?w=800&h=400&fit=crop&q=80",
    tagline: { en: "Every street tells a story", pt: "Cada rua conta uma história" },
    places: [
      { name: "Colosseum", emoji: "🏟️", rating: 4.7, reviews: "420K", photo: "https://images.unsplash.com/photo-1552832230-c0197dd311b5?w=300&h=200&fit=crop&q=80", tip: { en: "Underground tour is a must", pt: "Tour subterrâneo é imperdível" }, cat: "landmark" },
      { name: "Vatican Museums", emoji: "🖼️", rating: 4.6, reviews: "310K", photo: "https://images.unsplash.com/photo-1531572753322-ad063cecc140?w=300&h=200&fit=crop&q=80", tip: { en: "Friday nights have fewer crowds", pt: "Sextas à noite têm menos gente" }, cat: "museum" },
      { name: "Trastevere", emoji: "🍝", rating: 4.7, reviews: "78K", photo: "https://images.unsplash.com/photo-1529260830199-42c24126f198?w=300&h=200&fit=crop&q=80", tip: { en: "Best neighborhood for dinner", pt: "Melhor bairro para jantar" }, cat: "food" },
      { name: "Trevi Fountain", emoji: "⛲", rating: 4.7, reviews: "290K", photo: "https://images.unsplash.com/photo-1525874684015-58379d421a52?w=300&h=200&fit=crop&q=80", tip: { en: "Visit at 7am for no crowds", pt: "Visite às 7h sem multidões" }, cat: "landmark" },
      { name: "Aventine Keyhole", emoji: "🔑", rating: 4.8, reviews: "12K", photo: "https://images.unsplash.com/photo-1555992828-ca4dbe41d294?w=300&h=200&fit=crop&q=80", tip: { en: "Secret view of St. Peter's dome", pt: "Vista secreta do domo de São Pedro" }, cat: "gem", gem: true },
      { name: "Pantheon", emoji: "🏛️", rating: 4.8, reviews: "250K", photo: "https://images.unsplash.com/photo-1583265627959-fb7042f5133b?w=300&h=200&fit=crop&q=80", tip: { en: "Free entry, arrive when it rains", pt: "Entrada gratuita, vá quando chover" }, cat: "landmark" },
    ],
  },
  Barcelona: {
    hero: "https://images.unsplash.com/photo-1539037116277-4db20889f2d4?w=800&h=400&fit=crop&q=80",
    tagline: { en: "Art, beaches, and endless energy", pt: "Arte, praias e energia sem fim" },
    places: [
      { name: "Sagrada Família", emoji: "⛪", rating: 4.8, reviews: "280K", photo: "https://images.unsplash.com/photo-1583779457711-ab08daff090a?w=300&h=200&fit=crop&q=80", tip: { en: "Afternoon light through stained glass", pt: "Luz da tarde nos vitrais" }, cat: "landmark" },
      { name: "Park Güell", emoji: "🦎", rating: 4.5, reviews: "190K", photo: "https://images.unsplash.com/photo-1583422409516-2895a77efded?w=300&h=200&fit=crop&q=80", tip: { en: "First slot at 9:30am is quietest", pt: "Primeiro horário às 9:30 é o mais vazio" }, cat: "landmark" },
      { name: "La Boqueria Market", emoji: "🍓", rating: 4.5, reviews: "95K", photo: "https://images.unsplash.com/photo-1553701275-cdd4be087618?w=300&h=200&fit=crop&q=80", tip: { en: "Best smoothies and tapas", pt: "Melhores sucos e tapas" }, cat: "food" },
      { name: "Gothic Quarter", emoji: "🏰", rating: 4.6, reviews: "72K", photo: "https://images.unsplash.com/photo-1562883676-8c7feb83f09b?w=300&h=200&fit=crop&q=80", tip: { en: "Get lost in the medieval alleys", pt: "Perca-se nas ruelas medievais" }, cat: "neighborhood" },
      { name: "Bunkers del Carmel", emoji: "🌅", rating: 4.7, reviews: "18K", photo: "https://images.unsplash.com/photo-1558642452-9d2a7deb7f62?w=300&h=200&fit=crop&q=80", tip: { en: "Best sunset in Barcelona, free", pt: "Melhor pôr do sol de Barcelona, grátis" }, cat: "gem", gem: true },
      { name: "Barceloneta Beach", emoji: "🏖️", rating: 4.4, reviews: "110K", photo: "https://images.unsplash.com/photo-1523531294919-4bcd7c65e216?w=300&h=200&fit=crop&q=80", tip: { en: "Chiringuitos open until sunset", pt: "Chiringuitos abertos até o pôr do sol" }, cat: "beach" },
    ],
  },
  Bali: {
    hero: "https://images.unsplash.com/photo-1537996194471-e657df975ab4?w=800&h=400&fit=crop&q=80",
    tagline: { en: "Paradise found, soul renewed", pt: "Paraíso encontrado, alma renovada" },
    places: [
      { name: "Uluwatu Temple", emoji: "⛩️", rating: 4.7, reviews: "85K", photo: "https://images.unsplash.com/photo-1555400038-63f5ba517a47?w=300&h=200&fit=crop&q=80", tip: { en: "Kecak fire dance at sunset", pt: "Dança Kecak do fogo no pôr do sol" }, cat: "landmark" },
      { name: "Tegallalang Rice Terraces", emoji: "🌾", rating: 4.5, reviews: "62K", photo: "https://images.unsplash.com/photo-1531592263172-21153e24f3e0?w=300&h=200&fit=crop&q=80", tip: { en: "Go at 7am for empty terraces", pt: "Vá às 7h para terraços vazios" }, cat: "nature" },
      { name: "Ubud Monkey Forest", emoji: "🐒", rating: 4.5, reviews: "78K", photo: "https://images.unsplash.com/photo-1537953773345-d172ccf13cf4?w=300&h=200&fit=crop&q=80", tip: { en: "Hide your sunglasses!", pt: "Esconda seus óculos de sol!" }, cat: "activity" },
      { name: "Seminyak Beach Club", emoji: "🍹", rating: 4.6, reviews: "35K", photo: "https://images.unsplash.com/photo-1540202404-a2f29016b523?w=300&h=200&fit=crop&q=80", tip: { en: "Sunset cocktails are legendary", pt: "Coquetéis no pôr do sol são lendários" }, cat: "beach" },
      { name: "Tirta Gangga", emoji: "💧", rating: 4.6, reviews: "15K", photo: "https://images.unsplash.com/photo-1604922824961-87cefb2e4b07?w=300&h=200&fit=crop&q=80", tip: { en: "Hidden water palace, few tourists", pt: "Palácio aquático escondido, poucos turistas" }, cat: "gem", gem: true },
      { name: "Mount Batur Sunrise", emoji: "🌋", rating: 4.7, reviews: "42K", photo: "https://images.unsplash.com/photo-1588668214407-6ea9a6d8c272?w=300&h=200&fit=crop&q=80", tip: { en: "Wake at 2am, worth every second", pt: "Acorde às 2h, vale cada segundo" }, cat: "activity" },
    ],
  },
  "New York": {
    hero: "https://images.unsplash.com/photo-1496442226666-8d4d0e62e6e9?w=800&h=400&fit=crop&q=80",
    tagline: { en: "The city that never sleeps", pt: "A cidade que nunca dorme" },
    places: [
      { name: "Central Park", emoji: "🌳", rating: 4.8, reviews: "350K", photo: "https://images.unsplash.com/photo-1534430480872-3498386e7856?w=300&h=200&fit=crop&q=80", tip: { en: "Rent a bike for the full experience", pt: "Alugue uma bicicleta para a experiência completa" }, cat: "park" },
      { name: "Statue of Liberty", emoji: "🗽", rating: 4.7, reviews: "280K", photo: "https://images.unsplash.com/photo-1503174971373-b1f69850bded?w=300&h=200&fit=crop&q=80", tip: { en: "Book crown tickets months ahead", pt: "Reserve ingressos da coroa com meses" }, cat: "landmark" },
      { name: "Times Square", emoji: "🌃", rating: 4.5, reviews: "420K", photo: "https://images.unsplash.com/photo-1534430480872-3498386e7856?w=300&h=200&fit=crop&q=80", tip: { en: "Best at night, skip daytime", pt: "Melhor à noite, pule o dia" }, cat: "landmark" },
      { name: "Brooklyn Bridge", emoji: "🌉", rating: 4.8, reviews: "195K", photo: "https://images.unsplash.com/photo-1496588152823-86ff7695e68f?w=300&h=200&fit=crop&q=80", tip: { en: "Walk at sunrise for epic photos", pt: "Caminhe ao nascer do sol para fotos épicas" }, cat: "landmark" },
      { name: "Chelsea Market", emoji: "🦞", rating: 4.6, reviews: "45K", photo: "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=300&h=200&fit=crop&q=80", tip: { en: "Lobster Place + High Line combo", pt: "Lobster Place + High Line combo" }, cat: "food" },
      { name: "The High Line", emoji: "🌿", rating: 4.7, reviews: "88K", photo: "https://images.unsplash.com/photo-1500916434205-0c77489c6cf7?w=300&h=200&fit=crop&q=80", tip: { en: "Elevated park with art installations", pt: "Parque elevado com instalações de arte" }, cat: "gem", gem: true },
    ],
  },
};

export default function DestinationPreview({ destination, onClose }) {
  const { lang } = useLanguage();
  const { user } = useAuth();
  const navigate = useNavigate();
  const pt = lang === "pt-BR";
  const [hoveredIdx, setHoveredIdx] = useState(null);

  const data = DESTINATION_DATA[destination];
  if (!data) return null;

  const handleCreateTrip = () => {
    if (!user) {
      sessionStorage.setItem("voyara_pending_destination", destination);
      navigate("/login");
    } else {
      navigate("/dashboard?new=1");
    }
    onClose();
  };

  const gemCount = data.places.filter(p => p.gem).length;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col animate-scaleIn"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Hero header with destination photo */}
        <div className="relative h-44 sm:h-52 overflow-hidden flex-shrink-0">
          <img src={data.hero} alt={destination} className="absolute inset-0 w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-black/10" />

          {/* Close button */}
          <button onClick={onClose} className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/40 backdrop-blur-sm text-white hover:bg-black/60 transition-colors flex items-center justify-center z-10">
            ✕
          </button>

          {/* Destination info */}
          <div className="absolute bottom-0 left-0 right-0 p-5 sm:p-6">
            <div className="flex items-end justify-between">
              <div>
                <h2 className="text-2xl sm:text-3xl font-extrabold text-white mb-1">{destination}</h2>
                <p className="text-white/70 text-sm">{pt ? data.tagline.pt : data.tagline.en}</p>
              </div>
              <div className="flex items-center gap-3 text-white/80 text-xs">
                <span className="bg-white/20 backdrop-blur-sm px-2.5 py-1 rounded-full font-medium">
                  📍 {data.places.length} {pt ? "lugares" : "places"}
                </span>
                {gemCount > 0 && (
                  <span className="bg-amber-500/80 backdrop-blur-sm px-2.5 py-1 rounded-full font-medium">
                    💎 {gemCount} {pt ? (gemCount === 1 ? "joia" : "joias") : (gemCount === 1 ? "gem" : "gems")}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Subtitle */}
        <div className="px-5 sm:px-6 pt-4 pb-2">
          <p className="text-sm text-gray-500">
            {pt
              ? "Um preview do que o Voyara cria pra você. Imagine cada dia planejado assim:"
              : "A preview of what Voyara creates for you. Imagine every day planned like this:"}
          </p>
        </div>

        {/* Place cards */}
        <div className="flex-1 overflow-y-auto px-5 sm:px-6 pb-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {data.places.map((place, i) => (
              <div
                key={place.name}
                className={`rounded-xl border overflow-hidden transition-all duration-300 cursor-default ${
                  hoveredIdx === i
                    ? "border-coral-300 shadow-lg shadow-coral-100/50 -translate-y-0.5"
                    : "border-gray-100 shadow-sm hover:shadow-md"
                }`}
                onMouseEnter={() => setHoveredIdx(i)}
                onMouseLeave={() => setHoveredIdx(null)}
              >
                {/* Photo */}
                <div className="h-28 sm:h-32 overflow-hidden relative">
                  <img
                    src={place.photo}
                    alt={place.name}
                    className={`w-full h-full object-cover transition-transform duration-500 ${
                      hoveredIdx === i ? "scale-110" : "scale-100"
                    }`}
                    loading="lazy"
                  />
                  {/* Gem badge */}
                  {place.gem && (
                    <div className="absolute top-2 left-2 bg-amber-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 shadow-md">
                      💎 {pt ? "Joia escondida" : "Hidden gem"}
                    </div>
                  )}
                  {/* Rating badge */}
                  <div className="absolute top-2 right-2 bg-white/90 backdrop-blur-sm px-2 py-0.5 rounded-full flex items-center gap-1 shadow-sm">
                    <span className="text-amber-500 text-[10px]">★</span>
                    <span className="text-[11px] font-bold text-gray-800">{place.rating}</span>
                    <span className="text-[9px] text-gray-400">({place.reviews})</span>
                  </div>
                </div>

                {/* Info */}
                <div className="p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-base">{place.emoji}</span>
                    <h3 className="font-bold text-gray-900 text-sm">{place.name}</h3>
                  </div>
                  <p className="text-xs text-emerald-600 italic flex items-center gap-1">
                    <span className="text-emerald-500">✦</span>
                    {pt ? place.tip.pt : place.tip.en}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* CTA footer */}
        <div className="border-t border-gray-100 px-5 sm:px-6 py-4 bg-gradient-to-r from-coral-50/50 to-violet-50/50 flex-shrink-0">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="text-center sm:text-left">
              <p className="text-sm font-bold text-gray-900">
                {pt
                  ? `Quer ${data.places.length} lugares assim no seu roteiro?`
                  : `Want ${data.places.length} places like these in your itinerary?`}
              </p>
              <p className="text-xs text-gray-500">
                {pt
                  ? "Cole um link ou deixe a IA montar tudo — em 30 segundos."
                  : "Paste a link or let AI build it all — in 30 seconds."}
              </p>
            </div>
            <button
              onClick={handleCreateTrip}
              className="bg-coral-500 hover:bg-coral-600 text-white font-bold px-6 py-3 rounded-xl transition-all hover:shadow-lg hover:shadow-coral-200 text-sm whitespace-nowrap flex-shrink-0"
            >
              {pt ? "Montar meu roteiro →" : "Build my itinerary →"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
