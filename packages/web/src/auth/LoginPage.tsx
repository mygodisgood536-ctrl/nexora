import { useState, type FormEvent } from "react";
import { Button, Field, Input, IconLock, IconShield, useToast } from "@nexora/ui";
import { useSession } from "./SessionProvider";
import { ApiRequestError } from "../lib/api";
import type { CompanyTheme } from "../lib/theme";

/**
 * RULE 4.1 - one login per portal host: the company's identity is on screen
 * before anything is typed, and the form asks for the exact full name that
 * RULE 5.1.1 makes the username.
 */
export function LoginPage({ theme }: { theme: CompanyTheme | null }) {
  const { login } = useSession();
  const toast = useToast();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const company = theme?.company?.name ?? "This company";

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
      toast({ title: "Signed in", tone: "success" });
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(err.code === "COMPANY_NOT_OPERATIONAL" ? `${err.message} - the Platform Owner must activate it before anyone can sign in.` : err.message);
      } else {
        setError((err as Error).message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="nxl">
      <section className="nxl__brand">
        <div className="nx-row" style={{ gap: 12 }}>
          <span className="nxl__logo" aria-hidden="true">{company.slice(0, 1).toUpperCase()}</span>
          <strong style={{ fontSize: "1.05rem" }}>{company}</strong>
        </div>
        <div className="nx-stack">
          <h1>Sign in to your workspace.</h1>
          <p>
            Your full name is your username. After signing in you will complete your credential
            ritual once - password, authenticator, profile - before touching any record.
          </p>
          <div className="nxl__marks">
            <span className="nxl__mark"><IconShield size={14} /> Authenticator protected</span>
            <span className="nxl__mark"><IconLock size={14} /> Every action audited</span>
          </div>
        </div>
        <div style={{ fontSize: "0.8125rem", color: "rgb(255 255 255 / 0.7)" }}>
          Powered by Nexora
        </div>
      </section>

      <section className="nxl__form">
        <div className="nxl__card nx-stack">
          <div className="nx-stack nx-stack--sm">
            <span className="nx-eyebrow">{company}</span>
            <h2>Welcome back</h2>
            <p className="nx-muted">Use the exact full name the company gave you.</p>
          </div>

          <form className="nx-stack" onSubmit={(e) => void submit(e)} noValidate>
            <Field label="Full name (username)" htmlFor="login-username" required>
              <Input
                id="login-username"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Cornelius Adedeji Victor"
                required
                autoFocus
              />
            </Field>
            <Field label="Password" htmlFor="login-password" required>
              <Input
                id="login-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>

            {error && (
              <div className="nx-errorstate" role="alert">
                <IconShield size={18} />
                <span>{error}</span>
              </div>
            )}

            <Button type="submit" variant="primary" size="lg" block loading={busy}>
              Sign in
            </Button>
          </form>
        </div>
      </section>
    </div>
  );
}
