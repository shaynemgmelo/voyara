import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabase";

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();

  // Initialize — get current session from Supabase
  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      setLoading(false);
    });

    // Listen for auth state changes (login, logout, token refresh, OAuth callback)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, s) => {
        setSession(s);
        setUser(s?.user ?? null);
        setLoading(false);

        // On OAuth sign-in, redirect to dashboard
        if (event === "SIGNED_IN" && s) {
          // Small delay to ensure state is set before navigation
          setTimeout(() => {
            navigate("/dashboard", { replace: true });
          }, 100);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, [navigate]);

  // Sign up with email/password
  const register = useCallback(async (email, password, metadata = {}) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: metadata, // { name, avatar, etc. }
      },
    });
    if (error) throw error;
    return data;
  }, []);

  // Sign in with email/password
  const login = useCallback(async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
    return data;
  }, []);

  // Sign in with OAuth provider (Google, Apple, etc.)
  const loginWithProvider = useCallback(async (provider) => {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/dashboard`,
      },
    });
    if (error) throw error;
    return data;
  }, []);

  // Sign out
  const logout = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    setUser(null);
    setSession(null);
  }, []);

  // Update user profile metadata
  const updateProfile = useCallback(async (updates) => {
    const { data, error } = await supabase.auth.updateUser({
      data: updates,
    });
    if (error) throw error;
    setUser(data.user);
    return data.user;
  }, []);

  // Get the current access token (JWT) for API calls
  const getAccessToken = useCallback(async () => {
    const { data: { session: s } } = await supabase.auth.getSession();
    return s?.access_token || null;
  }, []);

  // Helper: get display name from user metadata
  const displayName = user?.user_metadata?.name
    || user?.user_metadata?.full_name
    || user?.email?.split("@")[0]
    || "";

  // Helper: get avatar URL
  const avatarUrl = user?.user_metadata?.avatar_url || null;

  const value = {
    user,
    session,
    loading,
    displayName,
    avatarUrl,
    login,
    register,
    loginWithProvider,
    logout,
    updateProfile,
    getAccessToken,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
