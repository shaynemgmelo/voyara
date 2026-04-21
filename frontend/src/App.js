import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, useLocation, Navigate } from "react-router-dom";
import { LanguageProvider } from "./i18n/LanguageContext";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import useSmoothScroll from "./hooks/useSmoothScroll";
import Header from "./components/layout/Header";
import Footer from "./components/layout/Footer";

// Landing is critical path — keep eager so the marketing page paints fast.
import LandingPage from "./pages/LandingPage";

// Everything else is route-split so the 1.39 MB bundle no longer ships on
// the homepage. Heavy libs (Swiper, Google Maps, dnd) live inside TripDetail
// and only load when an authenticated user opens a trip.
const AuthPage = lazy(() => import("./pages/AuthPage"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const TripCreate = lazy(() => import("./pages/TripCreate"));
const TripDetail = lazy(() => import("./pages/TripDetail"));
const PricingPage = lazy(() => import("./pages/PricingPage"));
const FeaturesPage = lazy(() => import("./pages/FeaturesPage"));
const PrivacyPage = lazy(() => import("./pages/PrivacyPage"));
const TermsPage = lazy(() => import("./pages/TermsPage"));
const SharedTripPage = lazy(() => import("./pages/SharedTripPage"));

// Minimal fallback that fits the brand — no extra libs, no flash.
function RouteLoader() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div
        className="w-6 h-6 border-2 border-coral-500 border-t-transparent rounded-full animate-spin"
        aria-label="Carregando"
      />
    </div>
  );
}

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return null;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
}

function AppContent() {
  useSmoothScroll();
  const location = useLocation();
  const isLanding = location.pathname === "/";
  const isAuth = location.pathname === "/login";
  const isPricing = location.pathname === "/pricing";
  const isFeatures = location.pathname === "/features";
  const isPrivacy = location.pathname === "/privacy";
  const isTerms = location.pathname === "/terms";
  const isShared = location.pathname.startsWith("/share/");

  // Footer: show on every page except auth flows + pages that already have
  // their own footer/CTA (landing, pricing, features, share, privacy, terms).
  const showFooter = !isAuth;
  const isStandalone =
    isLanding || isPricing || isFeatures || isPrivacy || isTerms || isShared;

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 text-gray-900">
      {!isLanding && !isAuth && !isPricing && !isFeatures && !isPrivacy && !isTerms && !isShared && <Header />}
      <main className="flex-1">
        <Suspense fallback={<RouteLoader />}>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/login" element={<AuthPage />} />
            <Route path="/pricing" element={<PricingPage />} />
            <Route path="/features" element={<FeaturesPage />} />
            <Route path="/privacy" element={<PrivacyPage />} />
            <Route path="/terms" element={<TermsPage />} />
            <Route path="/share/:token" element={<SharedTripPage />} />
            <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
            <Route path="/trips/new" element={<RequireAuth><TripCreate /></RequireAuth>} />
            <Route path="/trips/:id" element={<RequireAuth><TripDetail /></RequireAuth>} />
          </Routes>
        </Suspense>
      </main>
      {showFooter && !isStandalone && <Footer />}
    </div>
  );
}

function App() {
  return (
    <LanguageProvider>
      <BrowserRouter>
        <AuthProvider>
          <AppContent />
        </AuthProvider>
      </BrowserRouter>
    </LanguageProvider>
  );
}

export default App;
