"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

type AuthUser = {
  id: string;
  email: string;
  name: string | null;
  organization: string | null;
  role: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  permissions?: {
    microin: boolean;
  };
};

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  login: (input: { email: string; password: string }) => Promise<void>;
  register: (input: { email: string; password: string; name?: string | null }) => Promise<void>;
  logout: () => Promise<void>;
  /** Renews the access token from the refresh cookie; resolves to whether it worked. */
  refreshSession: () => Promise<boolean>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

type ApiResponse = {
  user?: AuthUser;
  error?: string;
  detail?: string;
};

async function parseResponse(res: Response): Promise<ApiResponse> {
  const text = await res.text();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function getCookieValue(name: string): string | null {
  if (typeof document === "undefined") {
    return null;
  }
  const escaped = name.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
  const match = document.cookie.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function buildInit(init: RequestInit = {}): RequestInit {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers ?? {});
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (!SAFE_METHODS.has(method)) {
    const csrfToken = getCookieValue("csrf_token");
    if (csrfToken) {
      headers.set("X-CSRF-Token", csrfToken);
    }
  }
  return {
    credentials: "include",
    ...init,
    headers,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const SESSION_CHECK_INTERVAL_MS = 60 * 1000;

  const refreshSession = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, buildInit({ method: "POST" }));
      const payload = await parseResponse(res);
      if (!res.ok || !payload.user) {
        setUser(null);
        return false;
      }
      setUser(payload.user);
      return true;
    } catch (e) {
      setUser(null);
      return false;
    }
  }, []);

  const fetchSession = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/auth/me`, buildInit({ method: "GET" }));
      if (res.ok) {
        const payload = await parseResponse(res);
        if (payload.user) {
          setUser(payload.user);
          return;
        }
      } else if (res.status === 401 || res.status === 403) {
        // 401 = no token, 403 = expired/invalid token — both mean: try to refresh
        await refreshSession();
        return;
      }
      setUser(null);
    } catch (e) {
      setUser(null);
    }
  }, [refreshSession]);

  useEffect(() => {
    (async () => {
      try {
        await fetchSession();
      } catch (error) {
        console.error("[auth] bootstrap failed", error);
        setUser(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [fetchSession]);

  useEffect(() => {
    if (!user) {
      return;
    }
    const interval = setInterval(() => {
      fetchSession().catch((error) => {
        console.error("[auth] session refresh failed", error);
        setUser(null);
      });
    }, SESSION_CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [user, fetchSession]);

  const login = useCallback(async (input: { email: string; password: string }) => {
    const res = await fetch(`${API_URL}/auth/login`, buildInit({ method: "POST", body: JSON.stringify(input) }));
    const payload = await parseResponse(res);
    if (!res.ok || !payload.user) {
      throw new Error(payload.error ?? payload.detail ?? "login-failed");
    }
    setUser(payload.user);
  }, []);

  const register = useCallback(
    async (input: { email: string; password: string; name?: string | null }) => {
      const res = await fetch(`${API_URL}/auth/signup`, buildInit({ method: "POST", body: JSON.stringify(input) }));
      const payload = await parseResponse(res);
      if (!res.ok) {
        throw new Error(payload.error ?? payload.detail ?? "register-failed");
      }
      if (payload.user) {
        setUser(payload.user);
      }
    },
    []
  );

  const logout = useCallback(async () => {
    try {
      await fetch(`${API_URL}/auth/logout`, buildInit({ method: "POST" }));
    } catch (e) {
      // Ignore logout errors
    }
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, register, logout, refreshSession }),
    [user, loading, login, register, logout, refreshSession]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
