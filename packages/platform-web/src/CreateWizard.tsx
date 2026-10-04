import { useState } from "react";
import { BUILT_IN_ROLES } from "@nexora/shared";
import { BrandPreview } from "./BrandPreview";

type Json = Record<string, unknown>;
export type AuthFn = <T = Json>(
  path: string,
  init?: RequestInit & { json?: unknown; method?: string }
) => Promise<T>;

export const NEXORA_DEFAULTS = {
  primaryColor: "#2547e0",
  secondaryColor: "#ffffff",
  accentColor: "#f59e0b",
  navyColor: "#0b1f4b",
  fontFamily: "Poppins"
};

export interface BrandingForm {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  navyColor: string;
  fontFamily: string;
  logoUrl: string;
  loginBackgroundUrl: string;
}

export const EMPTY_BRANDING: BrandingForm = { ...NEXORA_DEFAULTS, logoUrl: "", loginBackgroundUrl: "" };

export function brandingPayload(b: BrandingForm): Record<string, string | null> {
  return {
    primaryColor: b.primaryColor,
    secondaryColor: b.secondaryColor,
    accentColor: b.accentColor,
    navyColor: b.navyColor,
    fontFamily: b.fontFamily,
    logoUrl: b.logoUrl === "" ? null : b.logoUrl,
    loginBackgroundUrl: b.loginBackgroundUrl === "" ? null : b.loginBackgroundUrl
  };
}

const CARD = "rounded bg-[var(--nxp-color-surface)] p-4 shadow-[var(--nxp-shadow-card)]";
const INP = "rounded border border-[var(--nxp-color-surface-raised)] bg-transparent p-2";

/** Create Company Wizard (PO Spec §9): Profile → Branding (live preview) → Review. */
export function CreateWizard(props: {
  authed: AuthFn;
  onCreated: () => void;
  onError: (message: string) => void;
}) {
  const { authed, onCreated, onError } = props;
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState({ name: "", codePrefix: "", contactEmail: "", planTier: "" });
  const [md, setMd] = useState({ mdFullName: "", mdPhone: "", mdEmail: "" });
  const [panel, setPanel] = useState<Record<string, unknown> | null>(null);
  const [branding, setBranding] = useState<BrandingForm>(EMPTY_BRANDING);
  const [roles, setRoles] = useState<string[]>(BUILT_IN_ROLES.map((r) => r.key));
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <div className={CARD}>
        <button className="rounded bg-[var(--nxp-color-primary)] px-3 py-1 text-sm"
          onClick={() => { setOpen(true); setStep(0); setConfirmed(false); }}>
          + Create Company (wizard)
        </button>
        {panel && (
          <div className="mt-3 rounded border border-[var(--nxp-color-surface-raised)] p-3 text-sm">
            <strong>MD credentials — shown once, never retrievable again</strong>
            <div>Username: <code>{String(panel.username)}</code></div>
            <div>Initial password: <code>{String(panel.initial_password)}</code></div>
            <div>Worker code: <code>{String(panel.worker_code)}</code></div>
            <div>Expires: <code>{String(panel.expires_at)}</code></div>
            <button className="mt-2 underline" onClick={() => setPanel(null)}>I have recorded these</button>
          </div>
        )}
      </div>
    );
  }

  const steps = ["Company Profile", "Branding", "Review & Confirm"];
  const previewVars: Record<string, string> = {
    "--nx-color-primary": branding.primaryColor,
    "--nx-color-secondary": branding.secondaryColor,
    "--nx-color-accent": branding.accentColor,
    "--nx-color-navy": branding.navyColor
  };

  async function submit() {
    setBusy(true);
    try {
      const created = await authed<{ md?: Record<string, unknown> }>("/companies", {
        json: { ...profile, ...md, branding: brandingPayload(branding), enabledRoleKeys: roles }
      });
      // RULE 3.4.1 / 3.4.3 — the one-time credential panel is shown here and is
      // never retrievable again.
      setPanel(created?.md ?? null);
      setOpen(false);
      setStep(0);
      setProfile({ name: "", codePrefix: "", contactEmail: "", planTier: "" });
      setMd({ mdFullName: "", mdPhone: "", mdEmail: "" });
      setBranding(EMPTY_BRANDING);
      setConfirmed(false);
      onCreated();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={CARD}>
      <div className="flex items-center justify-between">
        <strong className="text-sm">Create Company — step {step + 1}/3: {steps[step]}</strong>
        <button className="underline text-sm" onClick={() => setOpen(false)}>Cancel</button>
      </div>

      {step === 0 && (
        <div className="mt-3 grid gap-2 md:grid-cols-4">
          <input placeholder="Company name" value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} className={INP} />
          <input placeholder="Prefix (ABC)" value={profile.codePrefix} onChange={(e) => setProfile({ ...profile, codePrefix: e.target.value.toUpperCase() })} className={INP} />
          <input placeholder="Contact/MD email" value={profile.contactEmail} onChange={(e) => setProfile({ ...profile, contactEmail: e.target.value })} className={INP} />
          <input placeholder="Plan tier (optional)" value={profile.planTier} onChange={(e) => setProfile({ ...profile, planTier: e.target.value })} className={INP} />
          <input placeholder="MD full name (required)" value={md.mdFullName} onChange={(e) => setMd({ ...md, mdFullName: e.target.value })} className={INP} />
          <input placeholder="MD phone (required)" value={md.mdPhone} onChange={(e) => setMd({ ...md, mdPhone: e.target.value })} className={INP} />
          <input placeholder="MD email (optional)" value={md.mdEmail} onChange={(e) => setMd({ ...md, mdEmail: e.target.value })} className={INP} />
        </div>
      )}

      {step === 1 && (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            {([["primaryColor", "Primary"], ["secondaryColor", "Secondary"], ["accentColor", "Accent"], ["navyColor", "Navy"]] as const).map(([field, label]) => (
              <div key={field} className="flex items-center gap-2">
                <input type="color" value={branding[field]} onChange={(e) => setBranding({ ...branding, [field]: e.target.value })} className="h-8 w-10" />
                <span className="w-20 text-sm">{label}</span>
                <input value={branding[field]} onChange={(e) => setBranding({ ...branding, [field]: e.target.value })} className={INP} />
              </div>
            ))}
            <input placeholder="Logo URL (https://… optional)" value={branding.logoUrl} onChange={(e) => setBranding({ ...branding, logoUrl: e.target.value })} className={`w-full ${INP}`} />
            <input placeholder="Login background URL (optional)" value={branding.loginBackgroundUrl} onChange={(e) => setBranding({ ...branding, loginBackgroundUrl: e.target.value })} className={`w-full ${INP}`} />
            <input placeholder="Font family" value={branding.fontFamily} onChange={(e) => setBranding({ ...branding, fontFamily: e.target.value })} className={`w-full ${INP}`} />
            <button className="text-sm underline"
              onClick={() => setBranding({ ...NEXORA_DEFAULTS, logoUrl: "", loginBackgroundUrl: "" })}>
              Reset to Nexora defaults
            </button>
          </div>
          <BrandPreview vars={previewVars} />
        </div>
      )}

      {step === 2 && (
        <div className="mt-3 space-y-2 text-sm">
          <pre className="max-h-40 overflow-auto rounded bg-[var(--nxp-color-surface-raised)] p-2 text-xs">
{JSON.stringify({ profile, branding: brandingPayload(branding), enabledRoleKeys: roles }, null, 2)}
          </pre>
          <details>
            <summary className="cursor-pointer">Enabled roles ({roles.length}/{BUILT_IN_ROLES.length})</summary>
            <div className="grid grid-cols-2 gap-x-4 md:grid-cols-3">
              {BUILT_IN_ROLES.map((r) => (
                <label key={r.key} className="text-xs">
                  <input type="checkbox" checked={roles.includes(r.key)}
                    onChange={(e) => setRoles(e.target.checked ? [...roles, r.key] : roles.filter((k) => k !== r.key))} />{" "}
                  {r.name}
                </label>
              ))}
            </div>
          </details>
          <label className="block text-xs">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />{" "}
            I confirm this company's details are correct
          </label>
        </div>
      )}

      <div className="mt-3 flex justify-between">
        <button disabled={step === 0} onClick={() => setStep(step - 1)}
          className="rounded bg-[var(--nxp-color-surface-raised)] px-3 py-1 text-sm disabled:opacity-40">Back</button>
        {step < 2 ? (
          <button onClick={() => setStep(step + 1)} className="rounded bg-[var(--nxp-color-primary)] px-3 py-1 text-sm">Next</button>
        ) : (
          <button disabled={!confirmed || busy || !md.mdFullName.trim() || !md.mdPhone.trim()} onClick={() => void submit()}
            className="rounded bg-[var(--nxp-color-primary)] px-3 py-1 text-sm disabled:opacity-40">
            {busy ? "Creating…" : "Create Company"}
          </button>
        )}
      </div>
    </div>
  );
}
