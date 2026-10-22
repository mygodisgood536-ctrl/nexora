import type { SVGProps } from "react";

/**
 * The Nexora brand mark.
 *
 * There was no brand asset in the project, so this is the authorised one: an
 * original mark built from the brand's own geometry - a rising "N" formed by
 * two strokes over a soft arc, suggesting growth and a ledger line.
 *
 * It is used in product-brand locations only (the Platform Owner console, the
 * company portal's product chrome, the splash). A company's own name and logo
 * occupy the company-identity locations and are never substituted with this
 * mark.
 */
export const NexoraMark = ({
  size = 28,
  className,
  ...rest
}: SVGProps<SVGSVGElement> & { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 40 40"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label="Nexora"
    className={className}
    {...rest}
  >
    <rect x="0" y="0" width="40" height="40" rx="11" fill="url(#nx-mark-bg)" />
    <path
      d="M11 28.5V11.5L20 22.5L29 11.5V28.5"
      stroke="url(#nx-mark-ink)"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M11 31.5C15.5 29 18 29.4 20 31.4C22 33.4 24.5 33.8 29 31.3"
      stroke="url(#nx-mark-teal)"
      strokeWidth="2"
      strokeLinecap="round"
    />
    <defs>
      <linearGradient id="nx-mark-bg" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
        <stop stopColor="#12204A" />
        <stop offset="1" stopColor="#0A1024" />
      </linearGradient>
      <linearGradient id="nx-mark-ink" x1="11" y1="11" x2="29" y2="28" gradientUnits="userSpaceOnUse">
        <stop stopColor="#FFFFFF" />
        <stop offset="1" stopColor="#C9D6FF" />
      </linearGradient>
      <linearGradient id="nx-mark-teal" x1="11" y1="29" x2="29" y2="34" gradientUnits="userSpaceOnUse">
        <stop stopColor="#5FD6C4" />
        <stop offset="1" stopColor="#7C9CFF" />
      </linearGradient>
    </defs>
  </svg>
);

/**
 * The Nexora wordmark: the mark beside the product name.
 *
 * `tone` selects the treatment for the surface it sits on - "light" for the
 * white workspace and "dark" for the brand splash.
 */
export function NexoraWordmark({
  size = 28,
  tone = "light",
  subtitle,
  className
}: {
  size?: number;
  tone?: "light" | "dark";
  subtitle?: string;
  className?: string;
}) {
  const name = tone === "dark" ? "#F3F6FC" : "#10141F";
  const sub = tone === "dark" ? "#8E9BB3" : "#616C82";
  return (
    <span
      className={className}
      style={{ display: "inline-flex", alignItems: "center", gap: 10, minWidth: 0 }}
    >
      <NexoraMark size={size} />
      <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.15, minWidth: 0 }}>
        <span
          style={{
            fontSize: size * 0.55,
            fontWeight: 650,
            letterSpacing: "-0.01em",
            color: name,
            fontFamily: "var(--nx-font-display)"
          }}
        >
          Nexora
        </span>
        {subtitle ? (
          <span style={{ fontSize: size * 0.32, color: sub, fontWeight: 500 }}>{subtitle}</span>
        ) : null}
      </span>
    </span>
  );
}
