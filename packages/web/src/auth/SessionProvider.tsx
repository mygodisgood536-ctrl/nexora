import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, getToken, setToken, tryRefresh, ApiRequestError } from "../lib/api";

export interface EffectiveRole {
  roleKey: string;
  scopeType: string;
  branchIds: readonly string[];
  permissions: readonly string[];
}

export interface Me {
  userId: string;
  companyId: string;
  branchId: string | null;
  roles: EffectiveRole[];
  permissions: readonly string[];
  activeRoleKey: string | null;
  mustChangePassword: boolean;
  credentialState: string;
}

export interface RitualStatus {
  credentialState: string;
  steps: {
    change_password: boolean;
    authenticator_setup: boolean;
    authenticator_verify: boolean;
    profile: boolean;
  };
  nextStep: "change_password" | "authenticator_setup" | "authenticator_verify" | "profile" | "complete";
}

type SessionState =
  | { state: "booting" }
  | { state: "anon" }
  | { state: "ritual"; me: Me; ritual: RitualStatus }
  | { state: "authed"; me: Me };

interface SessionApi {
  state: SessionState;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
  setRitual: (ritual: RitualStatus) => void;
  completeRitual: (accessToken: string) => void;
}

const SessionCtx = createContext<SessionApi | null>(null);

export function useSession(): SessionApi {
  const ctx = useContext(SessionCtx);
  if (!ctx) throw new Error("useSession outside SessionProvider");
  return ctx;
}

export function useMe(): Me {
  const { state } = useSession();
  if (state.state === "authed") return state.me;
  if (state.state === "ritual") return state.me;
  throw new Error("no authenticated principal");
}

async function loadMe(): Promise<Me> {
  return api<Me>("/auth/me");
}

async function loadRitual(): Promise<RitualStatus> {
  return api<RitualStatus>("/auth/ritual/status");
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ state: "booting" });

  const decide = useCallback(async (accessToken?: string) => {
    try {
      const me = await loadMe();
      if (me.credentialState !== "secured" || me.mustChangePassword) {
        const ritual = await loadRitual();
        if (ritual.nextStep !== "complete") {
          setState({ state: "ritual", me, ritual });
          return;
        }
      }
      setState({ state: "authed", me });
    } catch (err) {
      if (err instanceof ApiRequestError && (err.status === 401 || err.status === 403)) {
        setToken(null);
        setState({ state: "anon" });
        return;
      }
      // A network failure must not silently log the user out of a valid token.
      if (accessToken) setState({ state: "anon" });
      else setState((prev) => (prev.state === "booting" ? { state: "anon" } : prev));
    }
  }, []);

  useEffect(() => {
    void (async () => {
      if (getToken()) {
        await decide();
        return;
      }
      const renewed = await tryRefresh();
      if (renewed) {
        await decide(renewed.accessToken);
        return;
      }
      setState({ state: "anon" });
    })();
  }, [decide]);

  const login = useCallback(async (username: string, password: string) => {
    const issued = await api<{ accessToken: string; mustChangePassword: boolean; credentialState: string }>(
      "/auth/login",
      { method: "POST", json: { username, password }, token: null }
    );
    setToken(issued.accessToken);
    await decide(issued.accessToken);
  }, [decide]);

  const logout = useCallback(async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {
      /* session may already be gone */
    } finally {
      setToken(null);
      setState({ state: "anon" });
    }
  }, []);

  const refreshMe = useCallback(async () => {
    const me = await loadMe();
    setState({ state: "authed", me });
  }, []);

  const setRitual = useCallback((ritual: RitualStatus) => {
    setState((prev) => (prev.state === "ritual" ? { ...prev, ritual } : prev));
  }, []);

  const completeRitual = useCallback((accessToken: string) => {
    setToken(accessToken);
    void decide(accessToken);
  }, [decide]);

  const value = useMemo<SessionApi>(
    () => ({ state, login, logout, refreshMe, setRitual, completeRitual }),
    [state, login, logout, refreshMe, setRitual, completeRitual]
  );

  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}
