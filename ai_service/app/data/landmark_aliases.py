"""Alias dictionary for semantic deduplication of place names.

Each entry maps a canonical English name → list of known variants (Portuguese,
Spanish, official local name, common shortenings). The `semantic_deduplicate`
function in orchestrator.py uses this to catch e.g. "Cristo Redentor" ==
"Christ the Redeemer" == "Statue of Christ the Redeemer".

Kept deliberately short — only landmarks that travelers commonly write in
multiple languages. Unknown places fall through to token-level similarity.
"""

LANDMARK_ALIASES: dict[str, list[str]] = {
    # Brazil
    "Christ the Redeemer": [
        "Cristo Redentor", "Cristo Redemptor", "Statue of Christ the Redeemer",
        "Christ Redeemer Statue", "Christ Statue",
    ],
    "Sugarloaf Mountain": [
        "Pão de Açúcar", "Pao de Acucar", "Bondinho do Pão de Açúcar",
        "Sugarloaf", "Pan de Azúcar",
    ],
    "Copacabana Beach": ["Praia de Copacabana", "Copa"],
    "Ipanema Beach": ["Praia de Ipanema"],
    "Selarón Steps": [
        "Escadaria Selarón", "Escaderia Selaron", "Lapa Steps",
        "Selaron Staircase",
    ],
    # Argentina
    "Casa Rosada": ["Pink House", "Casa de Gobierno"],
    "Plaza de Mayo": ["May Square"],
    "Recoleta Cemetery": ["Cementerio de la Recoleta", "Cemitério da Recoleta"],
    "Caminito": ["Caminito La Boca", "La Boca Caminito"],
    "El Ateneo Grand Splendid": ["El Ateneo", "Ateneo Grand Splendid"],
    "Teatro Colón": ["Teatro Colon", "Colón Theatre"],
    "Avenida 9 de Julio": ["Av. 9 de Julio", "Av 9 de Julho", "9 de Julho Avenue"],
    "Obelisco": ["Obelisk of Buenos Aires", "Obelisco de Buenos Aires"],
    # France
    "Eiffel Tower": ["Tour Eiffel", "Torre Eiffel"],
    "Louvre Museum": ["Musée du Louvre", "Museu do Louvre", "The Louvre"],
    "Arc de Triomphe": ["Arco do Triunfo", "Arc of Triumph"],
    "Notre-Dame Cathedral": [
        "Notre Dame de Paris", "Catedral de Notre-Dame", "Notre Dame",
    ],
    "Champs-Élysées": ["Champs Elysees", "Avenida Champs-Élysées"],
    "Sacré-Cœur Basilica": [
        "Sacre Coeur", "Basílica do Sagrado Coração", "Montmartre Basilica",
    ],
    "Palace of Versailles": ["Palácio de Versalhes", "Château de Versailles"],
    # Italy
    "Colosseum": ["Coliseu", "Coliseo", "Colosseo", "Roman Colosseum"],
    "Trevi Fountain": ["Fontana di Trevi", "Fonte de Trevi"],
    "Pantheon": ["Panteão", "Panteón de Roma"],
    "Vatican City": ["Cidade do Vaticano", "Città del Vaticano"],
    "St. Peter's Basilica": [
        "Basílica de São Pedro", "Basilica di San Pietro", "Vatican Basilica",
    ],
    "Duomo di Milano": ["Milan Cathedral", "Catedral de Milão"],
    "St. Mark's Square": ["Piazza San Marco", "Praça de São Marcos"],
    "Leaning Tower of Pisa": [
        "Torre de Pisa", "Torre di Pisa", "Pisa Tower",
    ],
    # Spain
    "Sagrada Família": [
        "Sagrada Familia", "La Sagrada Família", "Basilica of the Sacred Family",
    ],
    "Park Güell": ["Parque Güell", "Parc Güell", "Park Guell"],
    "La Rambla": ["Las Ramblas", "Rambla"],
    "Casa Batlló": ["Casa Batllo"],
    # UK
    "Big Ben": ["Elizabeth Tower", "Torre do Relógio"],
    "Tower Bridge": ["Ponte da Torre"],
    "Buckingham Palace": ["Palácio de Buckingham"],
    "British Museum": ["Museu Britânico"],
    "London Eye": ["Roda de Londres", "Millennium Wheel"],
    "Westminster Abbey": ["Abadia de Westminster"],
    # USA
    "Statue of Liberty": ["Estátua da Liberdade", "Lady Liberty"],
    "Central Park": ["Parque Central"],
    "Times Square": ["Praça Times Square"],
    "Brooklyn Bridge": ["Ponte do Brooklyn"],
    "Empire State Building": ["Empire State"],
    "Hollywood Sign": ["Letreiro de Hollywood"],
    "Golden Gate Bridge": ["Ponte Golden Gate"],
    # Japan
    "Sensō-ji Temple": ["Senso-ji", "Templo Sensoji", "Asakusa Temple"],
    "Shibuya Crossing": ["Cruzamento de Shibuya", "Scramble Crossing"],
    "Meiji Shrine": ["Santuário Meiji"],
    "Tokyo Tower": ["Torre de Tóquio"],
    "Tokyo Skytree": ["Skytree"],
    # Other
    "Hagia Sophia": ["Santa Sofia", "Ayasofya"],
    "Blue Mosque": ["Mesquita Azul", "Sultanahmet Camii"],
    "Grand Bazaar": ["Grande Bazar", "Kapalı Çarşı"],
    "Burj Khalifa": ["Burj Khalifa Tower"],
    "Petra": ["Petra Ancient City"],
}


def build_alias_index() -> dict[str, str]:
    """Return a flat map `normalized_alias -> canonical_name` for O(1) lookup.
    Normalization: lowercase, strip accents, remove punctuation + extra spaces.
    """
    import re
    import unicodedata

    def _norm(s: str) -> str:
        s = unicodedata.normalize("NFKD", s).encode("ASCII", "ignore").decode("ASCII")
        s = re.sub(r"[^a-z0-9\s]+", " ", s.lower())
        return re.sub(r"\s+", " ", s).strip()

    index: dict[str, str] = {}
    for canonical, aliases in LANDMARK_ALIASES.items():
        index[_norm(canonical)] = canonical
        for a in aliases:
            index[_norm(a)] = canonical
    return index


# Pre-built at import time (cheap — ~100 entries).
ALIAS_INDEX: dict[str, str] = build_alias_index()
