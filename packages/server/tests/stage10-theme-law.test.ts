import { describe, it, expect } from "vitest";
import {
  parseHexColor,
  relativeLuminance,
  contrastRatio,
  labelColorFor,
  contrastWarning,
  DEFAULT_ACCENT,
  PLATFORM_ACCENT,
  themeRowToCssVars
} from "@nexora/shared";

describe("v3.9 Part 13 — colour, contrast and token law", () => {
  it("RULE 13.4.1 — the accent is one fixed brand colour, whatever a company stores", () => {
    // CHANGE 2026-10-22 (one Nexora brand) — the accent was near-black under
    // RULE 13.4.1 because it was about to be replaced by a company colour.
    // There is no company colour any more, so the accent is the single Nexora
    // brand value: a defined, legible colour, identical for every company.
    const lum = relativeLuminance(DEFAULT_ACCENT)!;
    expect(lum).toBeGreaterThan(0.02);
    expect(lum).toBeLessThan(0.25);
    // It is dark enough that the computed label is white.
    expect(labelColorFor(DEFAULT_ACCENT)).toBe("#ffffff");
    // And it is identical whatever a company record contains.
    expect(themeRowToCssVars({ primary_color: "#ff0000" })["--nx-color-accent"]).toBe(
      DEFAULT_ACCENT
    );
    expect(themeRowToCssVars({ accent_color: "#00ff00" })["--nx-color-accent"]).toBe(
      DEFAULT_ACCENT
    );
  });

  it("RULE 13.4.2 — the Platform Owner portal accent is green", () => {
    const { g, r, b } = parseHexColor(PLATFORM_ACCENT)!;
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
  });

  it("RULE 13.5.1 — the label colour is computed from the accent's luminance", () => {
    // A light accent gets a near-black label; a dark accent gets white.
    expect(labelColorFor("#f5e663")).toBe("#111111");
    expect(labelColorFor("#101828")).toBe("#ffffff");
    // The computed label always has adequate contrast against its accent.
    for (const accent of ["#ffffff", "#000000", "#f5e663", "#101828", "#16a34a", "#ff0000"]) {
      const label = labelColorFor(accent);
      expect(contrastRatio(accent, label)!).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("RULE 13.5.2 — a low-contrast colour warns and suggests a passing shade", () => {
    // A near-white accent is invisible on the neutral page surface.
    const warn = contrastWarning("#fdfdfd");
    expect(warn).not.toBeNull();
    expect(warn!.actual).toBeLessThan(4.5);
    expect(contrastRatio(warn!.suggested, labelColorFor(warn!.suggested))!)
      .toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(warn!.suggested, "#ffffff")!).toBeGreaterThanOrEqual(4.5);
    // The suggestion keeps the same hue relationship (it is a shade of the
    // same colour), never a different colour entirely.
    expect(warn!.suggested).toMatch(/^#[0-9a-f]{6}$/i);
    // A colour that already passes produces no warning.
    expect(contrastWarning("#101828")).toBeNull();
  });

  it("RULE 13.4.3 / 13.5.1 — the theme row emits the accent and its computed label", () => {
    const dark = themeRowToCssVars({ primary_color: "#101828" });
    expect(dark["--nx-color-primary"]).toBe("#101828");
    expect(dark["--nx-color-on-primary"]).toBe("#ffffff");

    // CHANGE 2026-10-22 (one Nexora brand) - the label on the accent is
    // computed from the FIXED accent, so it is the same for every company.
    const light = themeRowToCssVars({ primary_color: "#f5e663" });
    expect(light["--nx-color-on-primary"]).toBe("#ffffff");
    expect(light["--nx-color-accent"]).toBe(DEFAULT_ACCENT);

    // With no company record at all the fixed accent and its computed label apply.
    const none = themeRowToCssVars({});
    expect(none["--nx-color-accent"]).toBe(DEFAULT_ACCENT);
    expect(none["--nx-color-on-primary"]).toBe("#ffffff");
  });

  it("RULE 13.1.2 — the neutral base never changes with the company colour", () => {
    const a = themeRowToCssVars({ primary_color: "#ff0000" });
    const b = themeRowToCssVars({ primary_color: "#00ff00" });
    for (const key of ["--nx-color-bg", "--nx-color-surface", "--nx-color-text"]) {
      expect(a[key]).toBe(b[key]);
    }
    // Only the accent differs.
    expect(a["--nx-color-primary"]).not.toBe(b["--nx-color-primary"]);
  });
});
