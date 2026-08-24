import { useEffect, useState } from "react";
import { BUILT_IN_ROLES } from "@nexora/shared";

interface HealthResponse {
  status: string;
  service: string;
  db: string;
}

export default function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/healthz")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`status ${res.status}`))))
      .then(setHealth)
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <section className="w-full max-w-md rounded-[var(--nx-radius-card)] bg-[var(--nx-color-surface)] p-8 shadow-[var(--nx-shadow-card)]">
        <h1 className="text-2xl font-semibold text-[var(--nx-color-navy)]">Nexora</h1>
        <p className="mt-2 text-sm text-[var(--nx-color-text-muted)]">
          Multi-tenant microfinance operating system. Stage 0 foundation.
        </p>
        <dl className="mt-6 space-y-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-[var(--nx-color-text-muted)]">API</dt>
            <dd data-testid="api-status">
              {error ? (
                <span className="text-[var(--nx-color-danger)]">{error}</span>
              ) : health ? (
                <span className={health.db === "up" ? "text-[var(--nx-color-success)]" : "text-[var(--nx-color-danger)]"}>
                  {health.service} · db {health.db}
                </span>
              ) : (
                <span>Loading…</span>
              )}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-[var(--nx-color-text-muted)]">Built-in roles</dt>
            <dd>{BUILT_IN_ROLES.length}</dd>
          </div>
        </dl>
      </section>
    </main>
  );
}
