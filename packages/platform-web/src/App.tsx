import { useEffect, useState } from "react";

interface PlatformHealth {
  status: string;
  service: string;
  db: string;
}

export default function App() {
  const [health, setHealth] = useState<PlatformHealth | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/platform/v1/healthz")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`status ${res.status}`))))
      .then(setHealth)
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <section className="w-full max-w-md rounded-[var(--nxp-radius-card)] bg-[var(--nxp-color-surface)] p-8 shadow-[var(--nxp-shadow-card)]">
        <h1 className="text-2xl font-semibold">Nexora Platform</h1>
        <p className="mt-2 text-sm text-[var(--nxp-color-text-muted)]">
          Platform Owner Portal. Separate application surface from all company portals.
        </p>
        <dl className="mt-6 space-y-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-[var(--nxp-color-text-muted)]">Platform API</dt>
            <dd data-testid="platform-api-status">
              {error ? (
                <span className="text-[var(--nxp-color-danger)]">{error}</span>
              ) : health ? (
                <span className={health.db === "up" ? "text-[var(--nxp-color-success)]" : "text-[var(--nxp-color-danger)]"}>
                  {health.service} · db {health.db}
                </span>
              ) : (
                <span>Loading…</span>
              )}
            </dd>
          </div>
        </dl>
      </section>
    </main>
  );
}

