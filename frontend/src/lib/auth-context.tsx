"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { ApiError, errorMessage, readApiError } from "./api-errors";
import { TERMS_VERSION } from "./terms";
import { WIZARD_SNAPSHOT_KEY } from "./wizard-snapshot";

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
  /** Whether the account accepted the current /terminos, which include the consent for health data. */
  health_data_consent?: boolean;
};

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  login: (input: { email: string; password: string }) => Promise<void>;
  /**
   * "ambiguous" when the email already had an account: the server does not say
   * so outright, and nobody was signed in.
   */
  register: (input: {
    email: string;
    password: string;
    name?: string | null;
    termsAccepted: true;
  }) => Promise<"created" | "ambiguous">;
  /** Records that the signed-in account accepts the current /terminos. */
  acceptTerms: () => Promise<void>;
  /**
   * Deletes the signed-in account and everything it loaded. `confirmEmail` is
   * what the person typed to confirm. On success they are signed out.
   */
  deleteAccount: (confirmEmail: string) => Promise<void>;

  /** Resolves to whether the server signed the person out; on false a notice explains why. */
  logout: () => Promise<boolean>;
  /** Renews the access token from the refresh cookie; resolves to whether it worked. */
  refreshSession: () => Promise<boolean>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

type ApiResponse = {
  user?: AuthUser;
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

// What the wizard keeps in the browser holds clinical text: the draft history
// and searches that could not be saved to the account. None of it may outlive
// the session on what may be a shared computer.
const LOCAL_CLINICAL_KEYS = ["diagnosticar:hc-draft", "diagnosticar:records"];
const SESSION_CLINICAL_KEYS = ["diagnosticar:newDiagDraft", WIZARD_SNAPSHOT_KEY];

function forgetLocalClinicalData() {
  try {
    for (const key of LOCAL_CLINICAL_KEYS) window.localStorage.removeItem(key);
    for (const key of SESSION_CLINICAL_KEYS) window.sessionStorage.removeItem(key);
  } catch {
    // Storage blocked: nothing was kept.
  }
}

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

  // Only an answer that the session is gone signs the person out. A dropped
  // connection, a rate limit or a deploy in progress keeps them signed in, so
  // a half-filled search is not thrown away by a redirect to /login.
  const refreshSession = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, buildInit({ method: "POST" }));
      const payload = await parseResponse(res);
      if (res.ok && payload.user) {
        setUser(payload.user);
        return true;
      }
      if (res.status === 401 || res.status === 403) setUser(null);
      return false;
    } catch (e) {
      console.error("[auth] refresh failed", e);
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
      console.error("[auth] session check failed", res.status);
    } catch (e) {
      console.error("[auth] session check failed", e);
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
      fetchSession().catch((error) => console.error("[auth] session refresh failed", error));
    }, SESSION_CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [user, fetchSession]);

  const login = useCallback(async (input: { email: string; password: string }) => {
    const res = await fetch(`${API_URL}/auth/login`, buildInit({ method: "POST", body: JSON.stringify(input) }));
    if (!res.ok) throw await readApiError(res);
    const payload = await parseResponse(res);
    if (!payload.user) throw new ApiError("bad_response", { status: res.status });
    setUser(payload.user);
  }, []);

  const register = useCallback(
    async (input: { email: string; password: string; name?: string | null; termsAccepted: true }) => {
      const res = await fetch(`${API_URL}/auth/signup`, buildInit({ method: "POST", body: JSON.stringify(input) }));
      if (!res.ok) throw await readApiError(res);
      const payload = await parseResponse(res);
      if (!payload.user) return "ambiguous";
      setUser(payload.user);
      return "created";
    },
    []
  );

  const acceptTerms = useCallback(async () => {
    const res = await fetch(
      `${API_URL}/auth/consent`,
      buildInit({ method: "POST", body: JSON.stringify({ version: TERMS_VERSION }) }),
    );
    if (!res.ok) throw await readApiError(res);
    const payload = await parseResponse(res);
    if (!payload.user) throw new ApiError("bad_response", { status: res.status });
    setUser(payload.user);
  }, []);

  const deleteAccount = useCallback(async (confirmEmail: string) => {
    const res = await fetch(
      `${API_URL}/auth/account`,
      buildInit({ method: "DELETE", body: JSON.stringify({ confirmEmail }) }),
    );
    if (!res.ok) throw await readApiError(res);
    forgetLocalClinicalData();
    setUser(null);
  }, []);

  const [logoutFailure, setLogoutFailure] = useState<unknown>(null);

  // The session cookies are httpOnly, so only the server can clear them.
  // Showing the person as signed out before it has would sign them back in on
  // the next page load, on what may be a shared computer.
  const logout = useCallback(async () => {
    setLogoutFailure(null);
    let failure: unknown = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 700 * attempt));
      try {
        const res = await fetch(`${API_URL}/auth/logout`, buildInit({ method: "POST" }));
        if (res.ok) {
          forgetLocalClinicalData();
          setUser(null);
          return true;
        }
        failure = await readApiError(res);
        if (res.status < 500) break;
      } catch (error) {
        failure = error;
      }
    }
    console.error("[auth] logout failed", failure);
    setLogoutFailure(failure);
    return false;
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, register, acceptTerms, deleteAccount, logout, refreshSession }),
    [user, loading, login, register, acceptTerms, deleteAccount, logout, refreshSession]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
      {logoutFailure !== null && (
        <div className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-lg shadow-lg">
          <ErrorNotice
            message={`No pudimos cerrar tu sesión: seguís conectado en este dispositivo. ${errorMessage(logoutFailure)}`}
            onRetry={() => void logout()}
            retryLabel="Cerrar sesión de nuevo"
          />
        </div>
      )}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
