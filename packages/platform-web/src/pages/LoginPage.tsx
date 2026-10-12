import { useState, type FormEvent } from "react";
import { Button, Field, Input, IconLock, IconShield, IconCheck, useToast } from "@nexora/ui";
import {
  platformLogin,
  beginAuthenticatorSetup,
  verifyAuthenticatorSetup,
  type ApiError
} from "../lib/api";

/**
 * RULE 14.1.1 — "Authenticator verification is mandatory for every worker
 * account (all roles, all companies), the MD, the Platform Owner, and any
 * account performing a sensitive action." The Vision is explicit that the owner
 * "is not exempt from security".
 *
 * This screen is reached only when the server refuses a session with
 * AUTHENTICATOR_ENROLMENT_REQUIRED, which is the fail-closed behaviour added by
 * Vision finding F-01. There is no way to skip it: the server issues no session
 * until `verify` succeeds.
 */
export function LoginPage({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [needsTotp, setNeedsTotp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  // Enrolment sub-state
  const [enrolling, setEnrolling] = useState(false);
  const [seed, setSeed] = useState<string | null>(null);
  const [enrolCode, setEnrolCode] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await platformLogin(email.trim(), password, totp.trim() || undefined);
      toast({ title: "Signed in", text: "Platform owner session established.", tone: "success" });
      onSignedIn();
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr.code === "AUTHENTICATOR_ENROLMENT_REQUIRED") {
        setEnrolling(true);
        setNeedsTotp(false);
        setError("Your owner account has no authenticator yet. Set one up to continue.");
      } else if (apiErr.code === "TOTP_REQUIRED" || /authenticator|totp/i.test(apiErr.message)) {
        setNeedsTotp(true);
        setError("Enter the 6-digit code from your authenticator app.");
      } else {
        setError(apiErr.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function startEnrolment(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await beginAuthenticatorSetup(email.trim(), password);
      setSeed(result.secret);
      setError(null);
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnrolment(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await verifyAuthenticatorSetup(email.trim(), password, enrolCode.trim());
      setSeed(null);
      setEnrolling(false);
      setEnrolCode("");
      toast({
        title: "Authenticator enrolled",
        text: "Your second factor is active. Sign in with it from now on.",
        tone: "success"
      });
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="nxp-login">
      <section className="nxp-login__brand">
        <div className="nx-row" style={{ gap: 12 }}>
          <span className="nx-sidebar__logo" aria-hidden="true">N</span>
          <strong style={{ fontSize: "1.05rem" }}>Nexora Platform</strong>
        </div>
        <div className="nx-stack">
          <h1>The owner console for every Nexora company.</h1>
          <p>
            Create and brand companies, hand over MD credentials, watch platform health, and open
            time-bound support access - every action append-only audited.
          </p>
          <div className="nxp-login__marks">
            <span className="nxp-login__mark"><IconShield size={14} /> Authenticator challenge</span>
            <span className="nxp-login__mark"><IconLock size={14} /> Append-only audit</span>
            <span className="nxp-login__mark"><IconCheck size={14} /> Tenant-isolated by design</span>
          </div>
        </div>
        <div style={{ fontSize: "0.8125rem", color: "rgb(255 255 255 / 0.7)" }}>
          Owner sign-in lives only on this console. Company users never reach it.
        </div>
      </section>

      <section className="nxp-login__form">
        <div className="nxp-login__card nx-stack">
          <div className="nx-stack nx-stack--sm">
            <span className="nx-eyebrow">Platform Owner</span>
            <h2>{enrolling ? "Set up your authenticator" : "Sign in"}</h2>
            <p className="nx-muted">
              {enrolling
                ? seed
                  ? "Add this key to your authenticator app, then enter the code it shows."
                  : "Confirm your credentials to generate your one-time authenticator key."
                : "Use your owner email, password and authenticator code."}
            </p>
          </div>

          {enrolling && seed ? (
            <form className="nx-stack" onSubmit={(e) => void confirmEnrolment(e)} noValidate>
              <div className="nx-stack nx-stack--sm">
                <span className="nx-label">Your one-time key</span>
                <code
                  style={{
                    fontFamily: "var(--nx-font-mono)",
                    fontSize: "0.9rem",
                    background: "var(--nx-surface-sunken)",
                    border: "var(--nx-border) 1px solid",
                    borderRadius: "var(--nx-radius)",
                    padding: "10px 12px",
                    wordBreak: "break-all"
                  }}
                >
                  {seed}
                </code>
                <p className="nx-muted">
                  Enter it in your authenticator app. It is shown once and is never retrievable again.
                </p>
              </div>

              <Field label="Authenticator code" htmlFor="po-enrol-code" required hint="6 digits from your authenticator app">
                <Input
                  id="po-enrol-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={enrolCode}
                  onChange={(e) => setEnrolCode(e.target.value.replace(/\D/g, ""))}
                  autoFocus
                  required
                />
              </Field>

              {error && (
                <div className="nx-errorstate" role="alert">
                  <IconShield size={18} />
                  <span>{error}</span>
                </div>
              )}

              <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={enrolCode.length !== 6}>
                Verify and bind authenticator
              </Button>
            </form>
          ) : (
            <form className="nx-stack" onSubmit={(e) => void (enrolling ? startEnrolment(e) : submit(e))} noValidate>
              <Field label="Owner email" htmlFor="po-email" required>
                <Input
                  id="po-email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@nexora.app"
                  required
                />
              </Field>

              <Field label="Password" htmlFor="po-password" required>
                <Input
                  id="po-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </Field>

              {needsTotp && (
                <Field label="Authenticator code" htmlFor="po-totp" required hint="6 digits from your authenticator app">
                  <Input
                    id="po-totp"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={totp}
                    onChange={(e) => setTotp(e.target.value.replace(/\D/g, ""))}
                    placeholder="123456"
                    autoFocus
                  />
                </Field>
              )}

              {error && (
                <div className="nx-errorstate" role="alert">
                  <IconShield size={18} />
                  <span>{error}</span>
                </div>
              )}

              <Button type="submit" variant="primary" size="lg" block loading={busy}>
                {enrolling ? "Generate my authenticator key" : needsTotp ? "Verify and sign in" : "Sign in"}
              </Button>

              {enrolling && (
                <Button
                  type="button"
                  variant="ghost"
                  block
                  onClick={() => { setEnrolling(false); setError(null); }}
                >
                  Back to sign in
                </Button>
              )}
            </form>
          )}
        </div>
      </section>
    </div>
  );
}