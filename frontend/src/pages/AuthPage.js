import { useState } from "react";
import { useNavigate, Link, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useLanguage } from "../i18n/LanguageContext";
import Logo from "../components/layout/Logo";

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A11.96 11.96 0 0 0 1 12c0 1.94.46 3.77 1.18 5.42l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
    </svg>
  );
}

export default function AuthPage() {
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [socialLoading, setSocialLoading] = useState(null);

  const { login, register, loginWithProvider } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { t, toggle, lang } = useLanguage();
  const pt = lang === "pt-BR";

  const getRedirectPath = () => {
    const from = location.state?.from;
    if (from && from.pathname !== "/login") {
      return from.pathname + (from.search || "");
    }
    return "/dashboard?new=1";
  };

  const handleSocialLogin = async (provider) => {
    setSocialLoading(provider);
    setError("");
    try {
      await loginWithProvider(provider);
      // OAuth redirects to Supabase, then back to /dashboard
      // No navigate needed — Supabase handles the redirect
    } catch (err) {
      setError(
        err.message === "OAuth is not supported in this environment"
          ? (pt ? "OAuth não configurado. Configure o Google provider no Supabase Dashboard." : "OAuth not configured. Set up Google provider in Supabase Dashboard.")
          : err.message || t("auth.error")
      );
      setSocialLoading(null);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!email.trim() || !password.trim()) {
      setError(t("auth.required"));
      return;
    }
    if (mode === "register" && !name.trim()) {
      setError(t("auth.nameRequired"));
      return;
    }
    if (password.length < 6) {
      setError(t("auth.passwordMin"));
      return;
    }

    setSubmitting(true);

    try {
      if (mode === "login") {
        await login(email.trim().toLowerCase(), password);
        navigate(getRedirectPath());
      } else {
        const data = await register(email.trim().toLowerCase(), password, {
          name: name.trim(),
        });
        // Supabase may require email confirmation
        if (data?.user?.identities?.length === 0) {
          setError(pt ? "Este email já está cadastrado." : "This email is already registered.");
        } else if (data?.user && !data?.session) {
          // Email confirmation required
          setSuccess(
            pt
              ? "Conta criada! Verifique seu email para confirmar o cadastro."
              : "Account created! Check your email to confirm your registration."
          );
        } else {
          // Auto-confirmed (if email confirmation is disabled in Supabase)
          navigate(getRedirectPath());
        }
      }
    } catch (err) {
      const msg = err.message || "";
      if (msg.includes("Invalid login credentials")) {
        setError(pt ? "Email ou senha incorretos." : "Invalid email or password.");
      } else if (msg.includes("already registered")) {
        setError(pt ? "Este email já está cadastrado." : "This email is already registered.");
      } else if (msg.includes("Password should be at least")) {
        setError(pt ? "A senha deve ter no mínimo 6 caracteres." : "Password must be at least 6 characters.");
      } else {
        setError(msg || t("auth.error"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Nav */}
      <nav className="bg-white border-b border-gray-100 px-6 py-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
            <Logo size={30} />
            <span className="text-xl font-bold text-gray-900 tracking-tight">Voyara</span>
          </Link>
          <button
            onClick={toggle}
            className="text-sm text-gray-500 hover:text-gray-900 transition-colors"
          >
            {lang === "pt-BR" ? "EN" : "PT"}
          </button>
        </div>
      </nav>

      {/* Auth form */}
      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
            {/* Header */}
            <div className="px-8 pt-8 pb-4 text-center">
              <div className="w-14 h-14 rounded-full bg-coral-50 flex items-center justify-center mx-auto mb-4">
                <Logo size={28} />
              </div>
              <h1 className="text-2xl font-bold text-gray-900 mb-1">
                {mode === "login" ? t("auth.loginTitle") : t("auth.registerTitle")}
              </h1>
              <p className="text-sm text-gray-500">
                {mode === "login" ? t("auth.loginSubtitle") : t("auth.registerSubtitle")}
              </p>
            </div>

            {/* Tabs */}
            <div className="flex mx-8 mb-4 bg-gray-100 rounded-lg p-0.5">
              <button
                onClick={() => { setMode("login"); setError(""); setSuccess(""); }}
                className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${
                  mode === "login"
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {t("auth.login")}
              </button>
              <button
                onClick={() => { setMode("register"); setError(""); setSuccess(""); }}
                className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${
                  mode === "register"
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {t("auth.register")}
              </button>
            </div>

            {/* Social Login */}
            <div className="px-8 pb-2 space-y-2.5">
              <button
                type="button"
                onClick={() => handleSocialLogin("google")}
                disabled={socialLoading || submitting}
                className="w-full flex items-center justify-center gap-3 px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-300 disabled:opacity-50 transition-all shadow-sm"
              >
                {socialLoading === "google" ? (
                  <div className="w-4 h-4 border-2 border-gray-300 border-t-coral-500 rounded-full animate-spin" />
                ) : (
                  <GoogleIcon />
                )}
                {socialLoading === "google"
                  ? (pt ? "Conectando..." : "Connecting...")
                  : (pt ? "Continuar com Google" : "Continue with Google")}
              </button>

              <div className="flex items-center gap-3 py-1">
                <div className="flex-1 h-px bg-gray-200" />
                <span className="text-xs text-gray-400 font-medium">{pt ? "ou" : "or"}</span>
                <div className="flex-1 h-px bg-gray-200" />
              </div>
            </div>

            {/* Email Form */}
            <form onSubmit={handleSubmit} className="px-8 pb-8 space-y-4">
              {mode === "register" && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t("auth.name")}
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t("auth.namePlaceholder")}
                    className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-coral-500/20 focus:border-coral-500 transition-all"
                    autoComplete="name"
                  />
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t("auth.email")}
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t("auth.emailPlaceholder")}
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-coral-500/20 focus:border-coral-500 transition-all"
                  autoComplete="email"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t("auth.password")}
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t("auth.passwordPlaceholder")}
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-coral-500/20 focus:border-coral-500 transition-all"
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                />
              </div>

              {error && (
                <div className="bg-red-50 text-red-600 text-sm px-4 py-2.5 rounded-xl border border-red-100">
                  {error}
                </div>
              )}

              {success && (
                <div className="bg-emerald-50 text-emerald-700 text-sm px-4 py-2.5 rounded-xl border border-emerald-100">
                  {success}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-coral-500 hover:bg-coral-600 disabled:bg-coral-300 text-white font-semibold py-3 rounded-xl transition-colors shadow-sm text-sm"
              >
                {submitting
                  ? (mode === "login" ? t("auth.loggingIn") : t("auth.registering"))
                  : (mode === "login" ? t("auth.loginButton") : t("auth.registerButton"))}
              </button>

              {mode === "login" && (
                <p className="text-center text-xs text-gray-400">
                  {t("auth.forgotPassword")}
                </p>
              )}
            </form>
          </div>

          <p className="text-center text-sm text-gray-500 mt-6">
            {mode === "login" ? t("auth.noAccount") : t("auth.hasAccount")}{" "}
            <button
              onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); setSuccess(""); }}
              className="text-coral-500 font-medium hover:text-coral-600 transition-colors"
            >
              {mode === "login" ? t("auth.registerLink") : t("auth.loginLink")}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
