import { useCallback, useEffect, useState } from "react";
import { BrandingPanel } from "./BrandingPanel";
import { CreateWizard } from "./CreateWizard";

type Json = Record<string, unknown>;

type Authed = <T = Json>(
  path: string,
  init?: RequestInit & { json?: unknown; method?: string }
) => Promise<T>;

async function api<T = Json>(
  path: string,
  init: RequestInit & { json?: unknown; token?: string | null; method?: string } = {}
): Promise<T> {
  const { token, json, ...rest } = init;
  const res = await fetch(`/platform/v1${path}`, {
    credentials: "include",
    ...rest,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(rest.headers ?? {})
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({ error: { message: res.statusText } }))) as {
      error?: { message?: string; code?: string };
    };
    throw Object.assign(new Error(body.error?.message ?? res.statusText), { code: body.error?.code });
  }
  return (res.status === 204 ? (undefined as T) : ((await res.json()) as T));
}

export default function Portal() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("po_token"));
  const [view, setView] = useState<"companies" | "announcements" | "support" | "settings" | "audit">("companies");
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [needsTotp, setNeedsTotp] = useState(false);
  const [data, setData] = useState<{ companies: Json[]; announcements: Json[]; settings: Json[]; auditRows: Json[]; sessions: Json[] }>({
    companies: [], announcements: [], settings: [], auditRows: [], sessions: []
  });
  const [summary, setSummary] = useState<Json | null>(null);
  const [draft, setDraft] = useState({ title: "", body: "", severity: "info" });
  const [brandingId, setBrandingId] = useState<string | null>(null);

  const authed: Authed = useCallback(
    (path, init = {}) => api(path, { ...init, token }),
    [token]
  );

  const loadAll = useCallback(async () => {
    setError(null);
    try {
      setData({
        companies: await authed("/companies"),
        announcements: await authed("/announcements"),
        settings: await authed("/global-settings"),
        auditRows: await authed("/audit"),
        sessions: await authed("/support-access")
      });
    } catch (err) {
      setError((err as Error).message);
    }
  }, [authed]);

  useEffect(() => {
    if (token) void loadAll();
  }, [token, loadAll]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/platform/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email, password, totp: totp || undefined })
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({ error: { message: "Login failed" } }))) as {
        error?: { message?: string; code?: string };
      };
      if (body.error?.code === "TOTP_REQUIRED") setNeedsTotp(true);
      setError(body.error?.message ?? "Login failed");
      return;
    }
    const body = await res.json();
    localStorage.setItem("po_token", body.accessToken);
    setToken(body.accessToken);
  }

  async function act(path: string, json?: unknown, method = "POST") {
    setError(null);
    try {
      await authed(path, { method, json });
      await loadAll();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!token) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--nxp-color-bg)] p-6">
        <form onSubmit={handleLogin} className="w-full max-w-sm rounded bg-[var(--nxp-color-surface)] p-8 shadow-[var(--nxp-shadow-card)]">
          <h1 className="text-xl font-semibold text-[var(--nxp-color-text)]">Nexora Platform</h1>
          <input className="mt-4 w-full rounded border border-[var(--nxp-color-surface-raised)] bg-transparent p-2 text-[var(--nxp-color-text)]" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className="mt-3 w-full rounded border border-[var(--nxp-color-surface-raised)] bg-transparent p-2" placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          {needsTotp && (
            <input className="mt-3 w-full rounded border border-[var(--nxp-color-surface-raised)] bg-transparent p-2" placeholder="6-digit authenticator code" value={totp} onChange={(e) => setTotp(e.target.value)} />
          )}
          {error && <p className="mt-3 text-sm text-[var(--nxp-color-danger)]">{error}</p>}
          <button className="mt-4 w-full rounded bg-[var(--nxp-color-primary)] p-2 font-medium">Sign In</button>
        </form>
      </main>
    );
  }

  const card = "rounded bg-[var(--nxp-color-surface)] p-4 shadow-[var(--nxp-shadow-card)]";
  const inp = "rounded border border-[var(--nxp-color-surface-raised)] bg-transparent p-2";

  return (
    <main className="min-h-screen bg-[var(--nxp-color-bg)] p-6 text-[var(--nxp-color-text)]">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-xl font-semibold">Nexora Platform Owner</h1>
        {(["companies", "announcements", "support", "settings", "audit"] as const).map((v) => (
          <button key={v} onClick={() => setView(v)}
            className={`rounded px-3 py-1 text-sm ${view === v ? "bg-[var(--nxp-color-primary)]" : "bg-[var(--nxp-color-surface-raised)]"}`}>
            {v}
          </button>
        ))}
        <button className="rounded bg-[var(--nxp-color-danger)] px-3 py-1 text-sm"
          onClick={() => { localStorage.removeItem("po_token"); setToken(null); }}>Logout</button>
      </header>
      {error && <p className="mt-4 text-sm text-[var(--nxp-color-danger)]">{error}</p>}

      {view === "companies" && (
        <section className="mt-6 space-y-4">
          <CreateWizard authed={authed} onCreated={() => void loadAll()} onError={(m) => setError(m)} />
          <table className="w-full text-sm"><tbody>
            {data.companies.map((c) => (
              <tr key={String(c.id)} className="border-b border-[var(--nxp-color-surface-raised)]">
                <td className="p-2 font-medium">{String(c.name)}</td>
                <td>{String(c.code_prefix)}</td><td>{String(c.status)}</td>
                <td>{String(c.users)}u / {String(c.customers)}c / {String(c.branches)}b</td>
                <td className="space-x-2">
                  {(c.status === "in_setup" || c.status === "pending_activation") &&
                    <button className="underline" onClick={() => act(`/companies/${c.id}/status`, { action: "activate" })}>Activate</button>}
                  {c.status === "active" &&
                    <button className="underline" onClick={() => { const r = window.prompt("Suspension reason"); if (r) void act(`/companies/${c.id}/status`, { action: "suspend", reason: r }); }}>Suspend</button>}
                  {c.status === "suspended" &&
                    <button className="underline" onClick={() => act(`/companies/${c.id}/status`, { action: "reactivate" })}>Reactivate</button>}
                  <button className="underline" onClick={() => setBrandingId(brandingId === c.id ? null : (typeof c.id === "string" ? c.id : null))}>
                    Branding{brandingId === c.id ? " ▲" : ""}
                  </button>
                  <button className="underline" onClick={() => { const r = window.prompt("Support reason (10+ chars)"); if (typeof c.id === "string" && r) void act("/support-access", { companyId: c.id, reason: r, durationMinutes: 30 }); }}>Support</button>
                  <button className="underline" onClick={async () => {
                    const open = data.sessions.find((s) => s.company_name === c.name && s.is_open);
                    if (!open || typeof open.id !== "string" || typeof c.id !== "string") return;
                    try {
                      setSummary(await authed(`/companies/${c.id}/summary?sessionId=${open.id}`));
                      setView("support");
                    } catch (err) { setError((err as Error).message); }
                  }}>Drill down</button>
                </td>
              </tr>
            ))}
          </tbody></table>
          {brandingId && (
            <BrandingPanel authed={authed} companyId={brandingId} onError={(m) => setError(m)} />
          )}
        </section>
      )}

      {view === "announcements" && (
        <section className="mt-6 space-y-3">
          <ul className="space-y-2">{data.announcements.map((a) => (
            <li key={String(a.id)} className="flex items-center justify-between rounded bg-[var(--nxp-color-surface)] p-3 shadow-[var(--nxp-shadow-card)]">
              <span>{String(a.title)} · {String(a.severity)} · {String(a.status)}</span>
              <span className="space-x-2">
                {a.status === "draft" && <button className="underline" onClick={() => act(`/announcements/${a.id}/active`)}>Activate</button>}
                {a.status === "active" && <button className="underline" onClick={() => act(`/announcements/${a.id}/expired`)}>Expire</button>}
              </span>
            </li>
          ))}</ul>
          <div className={card}>
            <input placeholder="Title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className={`w-full ${inp}`} />
            <textarea placeholder="Body" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} className={`mt-2 w-full ${inp}`} />
            <select value={draft.severity} onChange={(e) => setDraft({ ...draft, severity: e.target.value })} className={`mt-2 ${inp}`}>
              <option>info</option><option>warning</option><option>critical</option>
            </select>
            <button onClick={() => act("/announcements", draft)} className="ml-2 rounded bg-[var(--nxp-color-primary)] p-2">Create draft</button>
          </div>
        </section>
      )}

      {view === "support" && (
        <section className="mt-6 space-y-4">
          {summary && <pre className={`${card} text-xs`}>{JSON.stringify(summary, null, 2)}</pre>}
          <ul className="space-y-2">{data.sessions.map((s) => (
            <li key={String(s.id)} className="flex items-center justify-between rounded bg-[var(--nxp-color-surface)] p-3 shadow-[var(--nxp-shadow-card)]">
              <span>{String(s.company_name)} · {String(s.reason)} · {String(s.is_open)}</span>
              {Boolean(s.is_open) && typeof s.id === "string" &&
                <button className="underline" onClick={() => act(`/support-access/${s.id}/close`)}>Close</button>}
            </li>
          ))}</ul>
        </section>
      )}

      {view === "settings" && (
        <ul className="mt-6 space-y-2">{data.settings.map((s) => (
          <li key={String(s.key)} className="flex items-center justify-between rounded bg-[var(--nxp-color-surface)] p-3 shadow-[var(--nxp-shadow-card)]">
            <code className="text-xs">{String(s.key)} = {JSON.stringify(s.value)}</code>
            <button className="underline" onClick={() => {
              const raw = window.prompt(`New JSON for ${String(s.key)}`, JSON.stringify(s.value));
              if (!raw) return;
              try {
                void act(`/global-settings/${encodeURIComponent(String(s.key))}`, JSON.parse(raw), "PUT");
              } catch { setError("Invalid JSON"); }
            }}>Edit</button>
          </li>
        ))}</ul>
      )}

      {view === "audit" && (
        <table className="w-full text-sm"><tbody>
          {data.auditRows.map((r) => (
            <tr key={String(r.id)}>
              <td className="py-1 pr-4">{new Date(String(r.created_at)).toLocaleString()}</td>
              <td className="pr-4">{String(r.actor)}</td><td>{String(r.action)}</td>
            </tr>
          ))}
        </tbody></table>
      )}
    </main>
  );
}
