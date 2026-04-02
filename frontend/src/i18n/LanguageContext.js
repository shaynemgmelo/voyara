import { createContext, useContext, useState, useCallback, useMemo } from "react";
import en from "./locales/en.json";
import ptBR from "./locales/pt-BR.json";

const locales = { en, "pt-BR": ptBR };

const LanguageContext = createContext();

/**
 * Resolve a dot-path key like "profile.title" from a translations object.
 * Supports {placeholder} interpolation: t("profile.howSplit", { days: 7 })
 */
function resolve(obj, path, vars) {
  let val = path.split(".").reduce((o, k) => (o ? o[k] : undefined), obj);
  if (val === undefined) return path; // fallback: show the key
  if (vars && typeof val === "string") {
    Object.entries(vars).forEach(([k, v]) => {
      val = val.replace(`{${k}}`, v);
    });
  }
  return val;
}

export function LanguageProvider({ children }) {
  const [lang, setLang] = useState(() => {
    return localStorage.getItem("app_language") || "pt-BR";
  });

  const switchLanguage = useCallback((newLang) => {
    setLang(newLang);
    localStorage.setItem("app_language", newLang);
  }, []);

  const toggle = useCallback(() => {
    const next = lang === "pt-BR" ? "en" : "pt-BR";
    switchLanguage(next);
  }, [lang, switchLanguage]);

  const t = useCallback(
    (key, vars) => resolve(locales[lang] || locales["pt-BR"], key, vars),
    [lang]
  );

  const value = useMemo(
    () => ({ lang, t, toggle, switchLanguage }),
    [lang, t, toggle, switchLanguage]
  );

  return (
    <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used within LanguageProvider");
  return ctx;
}
