// Curated day-trip suggestions per main city. Keys are normalized
// (lower-case, no accents) so lookups match regardless of case/casing.
// Free text is always allowed via the modal's search input — this list
// is just the fast path for the most common destinations.

const RAW = {
  "buenos aires": ["Tigre", "Colonia del Sacramento", "San Antonio de Areco"],
  "paris": ["Versailles", "Giverny", "Disneyland Paris"],
  "bangkok": ["Ayutthaya", "Damnoen Saduak", "Pattaya"],
  "tokyo": ["Hakone", "Nikko", "Kamakura"],
  "kyoto": ["Nara", "Osaka", "Arashiyama"],
  "rome": ["Tivoli", "Pompeii", "Castel Gandolfo"],
  "madrid": ["Toledo", "Segovia", "El Escorial"],
  "lisbon": ["Sintra", "Cascais", "Évora"],
  "lisboa": ["Sintra", "Cascais", "Évora"],
  "barcelona": ["Montserrat", "Sitges", "Girona"],
  "london": ["Stonehenge", "Oxford", "Bath"],
  "new york": ["Hudson Valley", "The Hamptons", "Philadelphia"],
  "rio de janeiro": ["Petrópolis", "Ilha Grande", "Búzios"],
  "são paulo": ["Campos do Jordão", "Santos", "Embu das Artes"],
  "sao paulo": ["Campos do Jordão", "Santos", "Embu das Artes"],
  "florença": ["Siena", "Pisa", "Cinque Terre"],
  "florence": ["Siena", "Pisa", "Cinque Terre"],
  "amsterdam": ["Zaanse Schans", "Keukenhof", "Utrecht"],
  "amsterdã": ["Zaanse Schans", "Keukenhof", "Utrecht"],
  "berlin": ["Potsdam", "Sachsenhausen", "Dresden"],
  "berlim": ["Potsdam", "Sachsenhausen", "Dresden"],
  "praga": ["Kutná Hora", "Karlovy Vary", "Český Krumlov"],
  "prague": ["Kutná Hora", "Karlovy Vary", "Český Krumlov"],
  "marrakech": ["Essaouira", "Atlas Mountains", "Ourika Valley"],
  "marraquexe": ["Essaouira", "Atlas Mountains", "Ourika Valley"],
  "istanbul": ["Princes' Islands", "Bursa", "Şile"],
  "istambul": ["Princes' Islands", "Bursa", "Şile"],
  "santiago": ["Valparaíso", "Viña del Mar", "Cajón del Maipo"],
  "lima": ["Paracas", "Cañete", "Lunahuaná"],
  "cusco": ["Machu Picchu", "Sacred Valley", "Rainbow Mountain"],
};

function normalize(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

export function getDayTripSuggestions(mainCity) {
  if (!mainCity) return [];
  const key = normalize(mainCity);
  return RAW[key] || [];
}
