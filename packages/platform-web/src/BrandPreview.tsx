import type { CSSProperties } from "react";

/**
 * Live branding preview (PO Spec §10): renders a miniature login screen and
 * sample dashboard using the SAME --nx-* CSS custom properties the real
 * company portal consumes — never a mocked image or hard-coded colors.
 */
export function BrandPreview({ vars }: { vars: Record<string, string> }) {
  const style = vars as CSSProperties;
  return (
    <div
      style={style}
      className="rounded border border-[var(--nxp-color-surface-raised)] p-3"
      data-testid="branding-preview"
    >
      {/* miniature login screen */}
      <div className="rounded p-4" style={{ background: "var(--nx-color-navy)" }}>
        <div className="mx-auto max-w-[220px] rounded p-3" style={{ background: "var(--nx-color-surface)" }}>
          <div className="text-center text-sm font-semibold" style={{ color: "var(--nx-color-navy)" }}>
            Sign in
          </div>
          <div className="mt-2 h-5 rounded border" style={{ borderColor: "var(--nx-color-text-muted)" }} />
          <div className="mt-1 h-5 rounded border" style={{ borderColor: "var(--nx-color-text-muted)" }} />
          <div
            className="mt-2 rounded p-1 text-center text-xs"
            style={{ background: "var(--nx-color-primary)", color: "var(--nx-color-secondary)" }}
          >
            Continue
          </div>
        </div>
      </div>
      {/* miniature dashboard cards */}
      <div className="mt-2 grid grid-cols-3 gap-2">
        {["Collections", "Par", "Savings"].map((label) => (
          <div key={label} className="rounded p-2" style={{ background: "var(--nx-color-surface)" }}>
            <div className="text-[10px]" style={{ color: "var(--nx-color-text-muted)" }}>{label}</div>
            <div className="text-sm font-semibold" style={{ color: "var(--nx-color-text)" }}>—</div>
            <div className="mt-1 h-1 rounded" style={{ background: "var(--nx-color-accent)" }} />
          </div>
        ))}
      </div>
    </div>
  );
}
