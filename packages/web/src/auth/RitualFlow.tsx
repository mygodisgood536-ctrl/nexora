import { useEffect, useState, type FormEvent } from "react";
import {
  Button,
  Card,
  Field,
  Input,
  IconCheck,
  IconKey,
  IconLock,
  IconShield,
  Progress,
  useToast
} from "@nexora/ui";
import { api, ApiRequestError } from "../lib/api";
import { useSession, type RitualStatus } from "./SessionProvider";

type StepKey = "authenticator" | "password" | "profile";

const STEP_ORDER: StepKey[] = ["authenticator", "password", "profile"];

const STEP_LABELS: Record<StepKey, string> = {
  authenticator: "Authenticator app",
  password: "New password",
  profile: "Your profile"
};

/**
 * RULE 4.2.1 / Part 5 - the mandatory credential ritual: enrol the
 * authenticator, prove it with a live code, change the initial password with
 * that same live code, then complete the profile. Nothing in the product is
 * reachable until this finishes.
 */
export function RitualFlow({ ritual, company }: { ritual: RitualStatus; company: string }) {
  const { setRitual, completeRitual, logout } = useSession();
  const toast = useToast();

  const firstOpen = !ritual.steps.authenticator_setup
    ? "authenticator"
    : !ritual.steps.change_password
    ? "password"
    : "profile";

  const [step, setStep] = useState<StepKey>(firstOpen);
  const [enrollment, setEnrollment] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const [code, setCode] = useState("");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [phone, setPhone] = useState("");
  const [birthDay, setBirthDay] = useState("");
  const [birthMonth, setBirthMonth] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const completed = STEP_ORDER.filter((k) =>
    k === "authenticator" ? ritual.steps.authenticator_setup && ritual.steps.authenticator_verify
    : k === "password" ? ritual.steps.change_password
    : ritual.steps.profile
  ).length;

  useEffect(() => {
    if (step !== "authenticator" || enrollment) return;
    setEnrolling(true);
    void (async () => {
      try {
        setEnrollment(await api<{ secret: string; otpauthUri: string }>("/auth/ritual/enrollment", { method: "POST", json: {} }));
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setEnrolling(false);
      }
    })();
  }, [step, enrollment]);

  async function fail(err: unknown): Promise<void> {
    const message = err instanceof ApiRequestError ? err.message : (err as Error).message;
    setError(message);
    toast({ title: "Step not accepted", text: message, tone: "danger" });
  }

  async function verifyCode(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/auth/ritual/verify-authenticator", { method: "POST", json: { code } });
      setRitual({ ...ritual, steps: { ...ritual.steps, authenticator_setup: true, authenticator_verify: true } });
      toast({ title: "Authenticator verified", tone: "success" });
      setStep("password");
      setCode("");
    } catch (err) {
      await fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    if (next !== confirm) {
      setError("The new password and its confirmation do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api("/auth/ritual/change-password", {
        method: "POST",
        json: { currentPassword: current, newPassword: next, confirmPassword: confirm, totpCode: code }
      });
      setRitual({ ...ritual, steps: { ...ritual.steps, change_password: true, authenticator_verify: true } });
      toast({ title: "Password changed", tone: "success" });
      setCurrent("");
      setNext("");
      setConfirm("");
      setStep("profile");
    } catch (err) {
      await fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function completeProfile(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const issued = await api<{ accessToken: string }>("/auth/ritual/complete-profile", {
        method: "POST",
        json: {
          phone: phone.trim() || null,
          birthDay: birthDay ? Number(birthDay) : null,
          birthMonth: birthMonth ? Number(birthMonth) : null,
          passportPhotoUrl: null
        }
      });
      toast({ title: "Account secured", text: "Your workspace is unlocking…", tone: "success" });
      completeRitual(issued.accessToken);
    } catch (err) {
      await fail(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="nxr">
      <div className="nxr__panel">
        <div className="nx-stack nx-stack--lg" style={{ width: "min(560px, 100%)" }}>
          <div className="nx-stack nx-stack--sm">
            <span className="nx-eyebrow">One-time credential ritual</span>
            <h1>Secure your account, {company}</h1>
            <p className="nx-muted">
              This runs exactly once. Until it finishes you can reach nothing inside the product -
              not a customer, not a shilling (RULE 4.2.1).
            </p>
          </div>

          <div className="nxr__steps">
            {STEP_ORDER.map((k, i) => {
              const at = STEP_ORDER.indexOf(step);
              const done =
                k === "authenticator" ? ritual.steps.authenticator_verify || at > 0
                : k === "password" ? ritual.steps.change_password || at > 1
                : ritual.steps.profile;
              const active = step === k;
              return (
                <span key={k} className={`nxr__step${active ? " is-active" : done ? " is-done" : ""}`}>
                  {done ? <IconCheck size={13} /> : <span className="nx-num">{i + 1}</span>}
                  {STEP_LABELS[k]}
                </span>
              );
            })}
          </div>
          <Progress value={completed} max={3} label={`${completed} of 3 steps complete`} />

          {step === "authenticator" && (
            <Card title="Step 1 - add your authenticator app">
              {enrolling && <p className="nx-muted">Generating your enrolment secret…</p>}
              {error && <div className="nx-errorstate" role="alert"><span>{error}</span></div>}
              {enrollment && (
                <div className="nx-stack">
                  <p style={{ fontSize: "var(--nx-text-sm)" }}>
                    Add this account to Google Authenticator, Authy or any TOTP app - scan nothing,
                    paste everything: copy the key below into the app, or open the setup link.
                  </p>
                  <Field label="Secret key" htmlFor="ritual-secret" hint="Manual entry key for your authenticator app">
                    <div className="nx-row" style={{ gap: 8 }}>
                      <Input id="ritual-secret" readOnly value={enrollment.secret} onFocus={(e) => e.currentTarget.select()} />
                      <Button
                        onClick={() => {
                          void navigator.clipboard?.writeText(enrollment.secret);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        }}
                      >
                        {copied ? "Copied" : "Copy"}
                      </Button>
                    </div>
                  </Field>
                  <details>
                    <summary style={{ cursor: "pointer", fontSize: "var(--nx-text-sm)" }}>Or open the setup link directly</summary>
                    <code className="nxr__uri">{enrollment.otpauthUri}</code>
                  </details>

                  <form className="nx-stack" onSubmit={(e) => void verifyCode(e)} noValidate>
                    <Field label="6-digit code from the app" htmlFor="ritual-code" required hint="Proves the app is wired up before we go further">
                      <Input
                        id="ritual-code"
                        inputMode="numeric"
                        maxLength={6}
                        value={code}
                        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                        placeholder="123456"
                        autoFocus
                      />
                    </Field>
                    <Button type="submit" variant="primary" loading={busy} disabled={code.length !== 6} icon={<IconShield size={15} />}>
                      Verify authenticator
                    </Button>
                  </form>
                </div>
              )}
            </Card>
          )}

          {step === "password" && (
            <Card title="Step 2 - replace the initial password">
              <form className="nx-stack" onSubmit={(e) => void changePassword(e)} noValidate>
                <p style={{ fontSize: "var(--nx-text-sm)" }} className="nx-muted">
                  The initial credential expires; your new password is permanent and must differ
                  from your name and username (RULE 5.3). A live authenticator code authorises the
                  change (RULE 5.3.2).
                </p>
                <Field label="Current (initial) password" htmlFor="rit-current" required>
                  <Input id="rit-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
                </Field>
                <Field label="New password" htmlFor="rit-new" required hint="At least the policy minimum; no part of your name">
                  <Input id="rit-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
                </Field>
                <Field label="Confirm new password" htmlFor="rit-confirm" required>
                  <Input id="rit-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
                </Field>
                <Field label="Authenticator code" htmlFor="rit-code" required hint="A fresh code - it must be live right now">
                  <Input id="rit-code" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="123456" />
                </Field>
                {error && <div className="nx-errorstate" role="alert"><span>{error}</span></div>}
                <Button type="submit" variant="primary" loading={busy} disabled={!current || next.length < 8 || next !== confirm || code.length !== 6} icon={<IconLock size={15} />}>
                  Change password
                </Button>
              </form>
            </Card>
          )}

          {step === "profile" && (
            <Card title="Step 3 - complete your profile">
              <form className="nx-stack" onSubmit={(e) => void completeProfile(e)} noValidate>
                <p style={{ fontSize: "var(--nx-text-sm)" }} className="nx-muted">
                  Day and month of birth only - the year is never collected (RULE 5.7.4). A passport
                  photo can be added later from your profile.
                </p>
                <Field label="Phone number" htmlFor="rit-phone" required>
                  <Input id="rit-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+234 800 000 0000" required />
                </Field>
                <div className="nx-grid nx-grid--2">
                  <Field label="Birth day" htmlFor="rit-day" required>
                    <Input id="rit-day" inputMode="numeric" maxLength={2} value={birthDay} onChange={(e) => setBirthDay(e.target.value.replace(/\D/g, ""))} placeholder="14" required />
                  </Field>
                  <Field label="Birth month" htmlFor="rit-month" required>
                    <select
                      id="rit-month"
                      className="nx-select"
                      value={birthMonth}
                      onChange={(e) => setBirthMonth(e.target.value)}
                      required
                    >
                      <option value="">Month…</option>
                      {Array.from({ length: 12 }, (_, i) => (
                        <option key={i + 1} value={String(i + 1)}>{i + 1}</option>
                      ))}
                    </select>
                  </Field>
                </div>
                {error && <div className="nx-errorstate" role="alert"><span>{error}</span></div>}
                <Button type="submit" variant="primary" size="lg" loading={busy} disabled={!phone.trim() || !birthDay || !birthMonth} icon={<IconKey size={15} />}>
                  Finish and enter the workspace
                </Button>
              </form>
            </Card>
          )}

          <div className="nx-row" style={{ gap: 10 }}>
            <span className="nx-faint" style={{ fontSize: "var(--nx-text-xs)" }}>
              Not your account, or stuck? Sign out and return to the login screen.
            </span>
            <div className="nx-grow" />
            <Button size="sm" variant="ghost" onClick={() => void logout()}>Sign out</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
