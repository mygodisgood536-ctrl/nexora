import { useState, type FormEvent } from "react";
import { Button, Field, Input, IconLock, IconShield, useToast } from "@nexora/ui";
import { useSession } from "./SessionProvider";
import { ApiRequestError } from "../lib/api";
import { companyLogo, type CompanyTheme } from "../lib/theme";

/**
 * RULE 4.1 - one login per portal host: the company's identity is on screen
 * before anything is typed, and the form asks for the exact full name that
 * RULE 5.1.1 makes the username.
 *
 * The split composition (identity left, form right) follows the owner's
 * reference site. The identity panel is a brand surface and carries the ink
 * palette; the form panel stays on the neutral layer that RULE 13.2 fixes, so
 * the company colour is still only a highlighter.
 */
export function LoginPage({ theme }: { theme: CompanyTheme | null }) {
  const { login } = useSession();
  const toast = useToast();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const company = theme?.company?.name ?? "This company";
  const logo = companyLogo();

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
        {/* The reference's masked grid backdrop and two glow orbs. */}
        <span className="nxl__bg nx-brand__grid" aria-hidden="true" />
        <span className="nxl__bg nxl__bg--accent" aria-hidden="true" />
        <span className="nxl__bg nxl__bg--teal" aria-hidden="true" />

        <div className="nxl__identity">
          <span className="nxl__logo">
            {/* RULE 13.6.1 - the logo. RULE 13.6.2 - the name placeholder
                stands in when there is no logo, never a broken image. */}
            {logo ? <img src={logo} alt="" /> : company.slice(0, 1).toUpperCase()}
          </span>
          <strong style={{ fontSize: "1.05rem", letterSpacing: "-0.01em" }}>{company}</strong>
        </div>

        <div className="nx-stack" style={{ gap: "var(--nx-space-4)" }}>
          <div>
            <p className="nxl__eyebrow">Company workspace</p>
            <h1>Sign in to your workspace.</h1>
          </div>
          <p>
            Your full name is your username. After signing in you will complete your credential
            ritual once &mdash; password, authenticator, profile &mdash; before touching any record.
          </p>
          <div className="nxl__marks">
            <span className="nxl__mark"><IconShield size={14} /> Authenticator protected</span>
            <span className="nxl__mark"><IconLock size={14} /> Every action audited</span>
          </div>
        </div>

        <p style={{ fontSize: "var(--nx-text-sm)", color: "var(--nx-brand-fg-subtle)" }}>
          Powered by Nexora
        </p>
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