import { useState, useEffect, useRef, useCallback } from "react";
import { autocomplete } from "../../api/googlePlaces";

// Single-input Google Places autocomplete for cities. Returns the chosen
// place via onSelect({city, country, place_id}). Used on the trip-create
// page to anchor the trip to a specific city upfront — eliminating the
// "video says 'Tailândia' (small town in Pará) when user meant Thailand"
// class of bugs and letting Tavily research kick off as soon as the form
// is submitted.
export default function CityAutocomplete({
  value,
  onSelect,
  onClear,
  placeholder,
  required = false,
}) {
  const [query, setQuery] = useState(value?.city || "");
  const [predictions, setPredictions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const debounceRef = useRef(null);
  const wrapperRef = useRef(null);

  useEffect(() => {
    setQuery(value?.city || "");
  }, [value?.city]);

  useEffect(() => {
    const handleClick = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleChange = useCallback((next) => {
    setQuery(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (value?.place_id && next !== value?.city) {
      // user typed over a previously-selected city — clear the saved selection
      if (onClear) onClear();
    }

    if (next.trim().length < 2) {
      setPredictions([]);
      setShowDropdown(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        // (cities) restricts to city/locality predictions — perfect for
        // the "main destination" picker.
        const res = await autocomplete(next, "(cities)");
        const preds = res.predictions || [];
        setPredictions(preds);
        setShowDropdown(preds.length > 0);
      } catch {
        setPredictions([]);
      } finally {
        setLoading(false);
      }
    }, 300);
  }, [value, onClear]);

  const handleSelect = (prediction) => {
    setShowDropdown(false);
    const main = prediction.structured_formatting?.main_text || prediction.description;
    const secondary = prediction.structured_formatting?.secondary_text || "";
    // secondary often looks like "Buenos Aires Province, Argentina" —
    // last comma-separated segment is the country.
    const segments = secondary.split(",").map((s) => s.trim()).filter(Boolean);
    const country = segments[segments.length - 1] || "";
    setQuery(main);
    onSelect({
      city: main,
      country,
      place_id: prediction.place_id,
      description: prediction.description,
    });
  };

  return (
    <div ref={wrapperRef} className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => predictions.length > 0 && setShowDropdown(true)}
        placeholder={placeholder}
        required={required}
        className="w-full bg-gray-50 border border-gray-300 rounded-lg px-4 py-2.5 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-coral-500"
      />
      {loading && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">
          ...
        </div>
      )}
      {showDropdown && predictions.length > 0 && (
        <ul className="absolute z-20 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-auto">
          {predictions.map((p) => (
            <li
              key={p.place_id}
              onClick={() => handleSelect(p)}
              className="px-4 py-2.5 hover:bg-coral-50 cursor-pointer text-sm border-b border-gray-100 last:border-0"
            >
              <div className="font-medium text-gray-900">
                {p.structured_formatting?.main_text || p.description}
              </div>
              {p.structured_formatting?.secondary_text && (
                <div className="text-xs text-gray-500">
                  {p.structured_formatting.secondary_text}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
