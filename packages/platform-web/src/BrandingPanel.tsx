import { useCallback, useEffect, useState } from "react";
import { BUILT_IN_ROLES } from "@nexora/shared";
import { BrandPreview } from "./BrandPreview";
import { brandingPayload, EMPTY_BRANDING, NEXORA_DEFAULTS } from "./CreateWizard";
import type { AuthFn, BrandingForm } from "./CreateWizard";

const CARD = "rounded bg-[var(--nxp-color-surface)] p-4 shadow-[var(--nxp-shadow-card)]";
const INP = "rounded border border-[var(--nxp-color-surface-raised)] bg-transparent p-2";

function rowToForm(row: Record<string, unknown>): BrandingForm {
  return {
    primaryColor: String(row.primary_color ?? NEXORA_DEFAULTS.primaryColor),
    secondaryColor: String(row.secondary_color ?? NEXORA_DEFAULTS.secondaryColor),
    accentColor: String(row.accent_color ?? NEXORA_DEFAULTS.accentColor),
    navyColor: String(row.navy_color ?? NEXORA_DEFAULTS.navyColor),
    fontFamily: String(row.font_family ?? NEXORA_DEFAULTS.fontFamily),
    logoUrl: typeof row.logo_url === "string" ? row.logo_url : "",
    loginBackgroundUrl: typeof row.login_background_url === "string" ? row.login_background_url : ""
  };
}

/**
 * Company Detail Workspace — Branding tab (PO Spec §8/§10): read/edit brand
 * tokens and enabled roles; live preview renders through the same --nx-*
 * custom-property mechanism the real portal uses.
 */
export function BrandingPanel(props: {
  authed: AuthFn;
  companyId: string;
  onError: (message: string) => void;
}) {
  const { authed, companyId, onError } = props;
  const [form, setForm] = useState<BrandingForm>(EMPTY_BRANDING);
  const [companyName, setCompanyName] = useState("");
  const [roles, setRoles] = useState<string[]>([]);
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    try {
      const themeRow = await authed<Record<string, unknown>>(`/companies/${companyId}/theme`);
      setForm(rowToForm(themeRow));
      setCompanyName(String(themeRow.company_name ?? ""));
      const keys = await authed<string[]>(`/companies/${companyId}/enabled-roles`);
      setRoles(Array.isArray(keys) ? keys : []);
    } catch (err) {
      onError((err as Error).message);
    }
  }, [authed, companyId, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(kind: "theme" | "roles") {
    try {
      if (kind === "theme") {
        await authed(`/companies/${companyId}/theme`, { method: "PUT", json: brandingPayload(form) });
        setStatus("Branding saved");
      } else {
        const res = await authed<{ enabled: string[] }>(`/companies/${companyId}/enabled-roles`, {
          method: "PUT",
          json: { enabledRoleKeys: roles }
        });
        setRoles(res.enabled);
        setStatus("Enabled roles saved");
      }
    } catch (err) {
      onError((err as Error).message);
      setStatus("");
    }
  }

  const previewVars: Record<string, string> = {
    "--nx-color-primary": form.primaryColor,
    "--nx-color-secondary": form.secondaryColor,
    "--nx-color-accent": form.accentColor,
    "--nx-color-navy": form.navyColor
  };

  return (
    <div className={CARD} data-testid="branding-panel">
      <strong className="text-sm">Branding & Roles{companyName ? ` — ${companyName}` : ""}</strong>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="space-y-2">
          {([["primaryColor", "Primary"], ["secondaryColor", "Secondary"], ["accentColor", "Accent"], ["navyColor", "Navy"]] as const).map(([field, label]) => (
            <div key={field} className="flex items-center gap-2">
              <input type="color" value={form[field]} onChange={(e) => setForm({ ...form, [field]: e.target.value })} className="h-8 w-10" />
              <span className="w-20 text-sm">{label}</span>
              <input value={form[field]} onChange={(e) => setForm({ ...form, [field]: e.target.value })} className={INP} />
            </div>
          ))}
          <input placeholder="Logo URL" value={form.logoUrl} onChange={(e) => setForm({ ...form, logoUrl: e.target.value })} className={`w-full ${INP}`} />
          <input placeholder="Login background URL" value={form.loginBackgroundUrl} onChange={(e) => setForm({ ...form, loginBackgroundUrl: e.target.value })} className={`w-full ${INP}`} />
          <input placeholder="Font family" value={form.fontFamily} onChange={(e) => setForm({ ...form, fontFamily: e.target.value })} className={`w-full ${INP}`} />
          <div className="space-x-3">
            <button className="rounded bg-[var(--nxp-color-primary)] px-3 py-1 text-sm" onClick={() => void save("theme")}>Save branding</button>
            <button className="text-sm underline"
              onClick={() => setForm({ ...NEXORA_DEFAULTS, logoUrl: "", loginBackgroundUrl: "" })}>
              Reset to Nexora defaults
            </button>
          </div>
          <details className="text-sm">
            <summary className="cursor-pointer">Enabled roles ({roles.length}/{BUILT_IN_ROLES.length})</summary>
            <div className="mt-1 grid max-h-48 grid-cols-2 gap-x-4 overflow-auto md:grid-cols-3">
              {BUILT_IN_ROLES.map((r) => (
                <label key={r.key} className="text-xs">
                  <input type="checkbox" checked={roles.includes(r.key)}
                    onChange={(e) => setRoles(e.target.checked ? [...roles, r.key] : roles.filter((k) => k !== r.key))} />{" "}
                  {r.name}
                </label>
              ))}
            </div>
            <button className="mt-2 rounded bg-[var(--nxp-color-primary)] px-3 py-1 text-xs" onClick={() => void save("roles")}>
              Save enabled roles
            </button>
          </details>
        </div>
        <BrandPreview vars={previewVars} />
      </div>
      {status && <p className="mt-2 text-xs text-[var(--nxp-color-success)]">{status}</p>}
    </div>
  );
}
