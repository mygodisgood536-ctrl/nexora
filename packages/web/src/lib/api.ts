export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown; requestId?: string };
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  constructor(status: number, body: ApiErrorBody["error"]) {
    super(body.message);
    this.status = status;
    this.code = body.code;
    this.details = body.details;
  }
}

const TOKEN_KEY = "nx_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export interface SessionPayload {
  accessToken: string;
  mustChangePassword: boolean;
  credentialState: string;
  principal?: unknown;
}

/**
 * API origin.
 *
 * Empty (the default) keeps every request same-origin and relative, which is
 * how the company portal is deployed: the Vercel project serves the SPA and the
 * Express function from ONE origin, so `/api/v1/...` needs no configuration and
 * no CORS grant.
 *
 * Set `VITE_API_BASE_URL` only if you deliberately split the API onto a
 * different origin. That then requires the API's `CORS_ORIGIN` to include this
 * portal's origin, or the browser will block the response.
 */
const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/+$/, "");

/**
 * Tenant prefix carried by the current address.
 *
 * When the portal is reached at `example.vercel.app/acme`, every API call goes
 * to `/acme/api/v1/...` so the server knows which tenant the request belongs to
 * BEFORE the credential is checked (RULE 2.4.1: the URL supplies the scope).
 * On a hostname-resolved portal (`acme.nexora.app`) the prefix is empty and the
 * address of the request already supplies the scope, so nothing changes.
 */
import { TENANT_PREFIX } from "./tenant-path";

export function apiUrl(path: string): string {
  const prefix = TENANT_PREFIX ? `/${TENANT_PREFIX}` : "";
  return `${API_BASE}${prefix}/api/v1${path}`;
}

/** Tries the refresh cookie to restore a session on boot. Returns the payload or null. */
export async function tryRefresh(): Promise<SessionPayload | null> {
  try {
    const res = await fetch(apiUrl("/auth/refresh"), {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
    if (!res.ok) return null;
    const body = (await res.json()) as SessionPayload;
    setToken(body.accessToken);
    return body;
  } catch {
    return null;
  }
}

export interface ApiClient {
  <T = unknown>(path: string, init?: RequestInit & { json?: unknown; token?: string | null }): Promise<T>;
  get<T = unknown>(path: string, init?: ApiGetInit): Promise<T>;
}

async function request<T = unknown>(
  path: string,
  init: RequestInit & { json?: unknown; token?: string | null } = {}
): Promise<T> {
  const { token, json, ...rest } = init;
  const auth = token === undefined ? getToken() : token;
  const res = await fetch(apiUrl(path), {
    credentials: "include",
    ...rest,
    headers: {
      "content-type": "application/json",
      ...(auth ? { authorization: `Bearer ${auth}` } : {}),
      ...(rest.headers ?? {})
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body
  });

  if (res.status === 401 && auth) {
    // One transparent refresh attempt, then replay the original request.
    const renewed = await tryRefresh();
    if (renewed) {
      return request<T>(path, { ...init, token: renewed.accessToken });
    }
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiRequestError(res.status, body?.error ?? { code: "UNKNOWN", message: res.statusText });
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** GET helper: appends `params`, then performs the same request as `api`. */
export interface ApiGetInit {
  params?: URLSearchParams | Record<string, string | number | boolean | undefined>;
  [key: string]: unknown;
}

async function get<T = unknown>(path: string, init: ApiGetInit = {}): Promise<T> {
  const { params, ...rest } = init;
  let target = path;
  if (params) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
    }
    const qs = q.toString();
    if (qs) target += (target.includes("?") ? "&" : "?") + qs;
  }
  return request<T>(target, { ...(rest as RequestInit & { json?: unknown }) });
}

export const api: ApiClient = Object.assign(request, { get });

export const http = api;

/** Normalises list responses: arrays or `{items}` pages. */
export function itemsOf<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object" && Array.isArray((value as { items?: unknown }).items)) {
    return (value as { items: T[] }).items;
  }
  return [];
}
