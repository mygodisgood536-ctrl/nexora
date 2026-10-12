export interface Branding {
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  navyColor?: string;
  logoUrl?: string | null;
  loginBackgroundUrl?: string | null;
  fontFamily?: string;
}

/**
 * RULE 3.3.2 - the wizard previews the real login page, header and sidebar as
 * colours are chosen. The preview is illustrative; the actual sign-in page
 * applies the saved tokens before first paint (RULE 13.4.1).
 */
export function BrandPreview({ brand, companyName }: { brand: Branding; companyName: string }) {
  const accent = brand.accentColor || brand.primaryColor || "#0f7b4f";
  const onAccent = contrastOn(accent);
  const font = brand.fontFamily ? `"${brand.fontFamily}", Poppins, system-ui, sans-serif` : undefined;
  const name = companyName.trim() || "Company name";

  return (
    <div className="nxp-preview" style={{ ["--pv-accent" as string]: accent, ["--pv-on-accent" as string]: onAccent, fontFamily: font }}>
      <div className="nxp-preview__bar" />
      <div className="nxp-preview__body">
        <div className="nx-row" style={{ justifyContent: "space-between" }}>
          <strong style={{ fontSize: "0.9rem" }}>{name}</strong>
          <span className="nx-faint" style={{ fontSize: "0.7rem" }}>login page preview</span>
        </div>

        <div className="nxp-preview__login">
          <div className="nx-row" style={{ gap: 8 }}>
            {brand.logoUrl ? (
              <img src={brand.logoUrl} alt="" style={{ width: 22, height: 22, borderRadius: 6, objectFit: "cover" }} />
            ) : (
              <span
                aria-hidden="true"
                style={{ width: 22, height: 22, borderRadius: 6, background: accent, color: onAccent, display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700 }}
              >
                {name.slice(0, 1).toUpperCase()}
              </span>
            )}
            <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>Sign in to {name}</span>
          </div>
          <div style={{ height: 26, borderRadius: 6, border: "1px solid var(--nx-border)", background: "var(--nx-bg-app)" }} />
          <div style={{ height: 26, borderRadius: 6, border: "1px solid var(--nx-border)", background: "var(--nx-bg-app)" }} />
          <button type="button" className="nxp-preview__btn" tabIndex={-1}>Sign in</button>
        </div>

        <div className="nxp-preview__side">
          <span style={{ width: 26, height: 26, borderRadius: 8, background: accent, color: onAccent, display: "grid", placeItems: "center", fontSize: 13, fontWeight: 700 }}>
            {name.slice(0, 1).toUpperCase()}
          </span>
          <div className="nx-stack" style={{ gap: 4, flex: 1 }}>
            <span className="nxp-preview__active">Dashboard</span>
            <span style={{ fontSize: "0.72rem", color: "var(--nx-text-muted)" }}>Customers</span>
            <span style={{ fontSize: "0.72rem", color: "var(--nx-text-muted)" }}>Loans</span>
          </div>
          <span style={{ width: 34, height: 34, borderRadius: 999, background: accent, color: onAccent, display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700 }}>
            MD
          </span>
        </div>

        <div className="nxp-swatch-row">
          {[accent, brand.primaryColor, brand.secondaryColor, brand.navyColor]
            .filter((c): c is string => Boolean(c))
            .map((c, i) => (
              <span key={`${c}-${i}`} title={c} style={{ width: 26, height: 26, borderRadius: 8, background: c, border: "1px solid rgb(0 0 0 / 0.1)" }} />
            ))}
        </div>
      </div>
    </div>
  );
}

/** Picks white or near-black text for a hex background (RULE 13.2 legibility). */
function contrastOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#ffffff";
  const n = parseInt(m[1]!, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 150 ? "#101418" : "#ffffff";
}
