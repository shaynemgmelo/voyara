import { BrowserRouter, Routes, Route, useLocation, Navigate } from "react-router-dom";
import { LanguageProvider } from "./i18n/LanguageContext";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import Header from "./components/layout/Header";
import LandingPage from "./pages/LandingPage";
import Dashboard from "./pages/Dashboard";
import TripCreate from "./pages/TripCreate";
import TripDetail from "./pages/TripDetail";
import AuthPage from "./pages/AuthPage";
import PricingPage from "./pages/PricingPage";
import FeaturesPage from "./pages/FeaturesPage";
import PrivacyPage from "./pages/PrivacyPage";
import TermsPage from "./pages/TermsPage";

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return null;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
}

function AppContent() {
  const location = useLocation();
  const isLanding = location.pathname === "/";
  const isAuth = location.pathname === "/login";
  const isPricing = location.pathname === "/pricing";
  const isFeatures = location.pathname === "/features";
  const isPrivacy = location.pathname === "/privacy";
  const isTerms = location.pathname === "/terms";

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      {!isLanding && !isAuth && !isPricing && !isFeatures && !isPrivacy && !isTerms && <Header />}
      <main>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<AuthPage />} />
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/features" element={<FeaturesPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
          <Route path="/trips/new" element={<RequireAuth><TripCreate /></RequireAuth>} />
          <Route path="/trips/:id" element={<RequireAuth><TripDetail /></RequireAuth>} />
        </Routes>
      </main>
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
