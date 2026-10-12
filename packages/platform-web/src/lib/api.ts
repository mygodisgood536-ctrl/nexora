export type Json = Record<string, unknown>;

const TOKEN_KEY = "nexora_po_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  code?: string;
  status?: number;
  constructor(message: string, code?: string, status?: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/**
 * Platform API origin.
 *
 * The Platform Owner console is deployed as its OWN Vercel project (VISION
 * Part 3: "Not reachable from any company URL"), so it is a different origin
 * from the company portal and from the API. Set `VITE_PLATFORM_API_BASE_URL` to
 * the deployed API origin; the API's `CORS_ORIGIN` must include this console's
 * origin, and `credentials: "include"` is already set so the refresh cookie
 * works cross-origin.
 *
 * Left empty it stays relative, which is what local development and a
 * single-origin setup use.
 */
const API_BASE = (import.meta.env.VITE_PLATFORM_API_BASE_URL ?? "").replace(/\/+$/, "");

export function platformUrl(path: string): string {
  return `${API_BASE}/platform/v1${path}`;
}

export async function api<T = Json>(
  path: string,
  init: RequestInit & { json?: unknown; token?: string | null } = {}
): Promise<T> {
  const { token, json, ...rest } = init;
  const auth = token === undefined ? getToken() : token;
  const res = await fetch(platformUrl(path), {
    credentials: "include",
    ...rest,
    headers: {
      "content-type": "application/json",
      ...(auth ? { authorization: `Bearer ${auth}` } : {}),
      ...(rest.headers ?? {})
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string; code?: string } } | null;
    throw new ApiError(body?.error?.message ?? `Request failed (${res.status})`, body?.error?.code, res.status);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Login and persist the access token. Returns the owner record. */
export async function platformLogin(email: string, password: string, totp?: string): Promise<{ ownerId: string; email: string }> {
  const body = await api<{ accessToken: string; owner: { id?: string; ownerId?: string; email?: string } }>(
    "/auth/login",
    { method: "POST", json: { email, password, ...(totp ? { totp } : {}) }, token: null }
  );
  setToken(body.accessToken);
  return { ownerId: body.owner?.ownerId ?? body.owner?.id ?? "", email: body.owner?.email ?? email };
}

/**
 * RULE 14.1.1 / 14.2.1 - the owner's authenticator enrolment path.
 *
 * `setup` returns the seed exactly once. It is shown to the person enrolling and
 * never stored client-side beyond component state, never logged, and never
 * retrievable again (RULE 14.5.1). `verify` binds it; only then does login
 * succeed.
 */
export async function beginAuthenticatorSetup(
  email: string,
  password: string
): Promise<{ email: string; secret: string; otpauthUri: string }> {
  return api<{ email: string; secret: string; otpauthUri: string }>("/auth/authenticator/setup", {
    method: "POST",
    json: { email, password },
    token: null
  });
}

export async function verifyAuthenticatorSetup(email: string, password: string, code: string): Promise<void> {
  await api("/auth/authenticator/verify", { method: "POST", json: { email, password, code }, token: null });
}

export async function platformLogout(): Promise<void> {
  try {
    await api("/auth/logout", { method: "POST" });
  } catch {
    /* session may already be gone */
  } finally {
    setToken(null);
  }
}

/** Normalises list responses: some endpoints return an array, some a page. */
export function itemsOf<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object" && Array.isArray((value as { items?: unknown }).items)) {
    return (value as { items: T[] }).items;
  }
  return [];
}
