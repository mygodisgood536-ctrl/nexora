import { describe, expect, it } from "vitest";
import {
  CHANGE_LOG_2026_10_22_SINGLE_NEXORA_BRAND,
  DEFAULT_ACCENT,
  HEX_COLOR_RE,
  THEME_VAR_MAP,
  themeRowToCssVars
} from "../src/theme";

describe("theme token architecture", () => {
  it("maps every themed column to its --nx-* CSS custom property", () => {
    expect(THEME_VAR_MAP.primary_color).toBe("--nx-color-primary");
    expect(THEME_VAR_MAP.secondary_color).toBe("--nx-color-secondary");
    expect(THEME_VAR_MAP.navy_color).toBe("--nx-color-navy");
    expect(THEME_VAR_MAP.font_family).toBe("--nx-font-family");
  });

  // CHANGE 2026-10-22 (one Nexora brand) - a company's stored colour can no
  // longer reach the workspace accent. The accent is fixed for the whole
  // product; a company supplies its name and its logo.
  it("never lets a stored company colour move the workspace accent", () => {
    const vars = themeRowToCssVars({
      primary_color: "#112233",
      secondary_color: "#ffffff",
      accent_color: "#f59e0b",
      navy_color: "#0b1f4b"
    });
    expect(vars["--nx-color-accent"]).toBe(DEFAULT_ACCENT);
    expect(vars["--nx-color-accent"]).not.toBe("#112233");
    expect(vars["--nx-color-accent"]).not.toBe("#f59e0b");
    // The stored identity colours still reach their own brand surfaces, which
    // RULE 13.3 explicitly allows.
    expect(vars["--nx-color-primary"]).toBe("#112233");
    expect(vars["--nx-color-secondary"]).toBe("#ffffff");
    expect(vars["--nx-color-navy"]).toBe("#0b1f4b");
    // RULE 13.5.1 - the label on the accent is computed, never chosen.
    expect(vars["--nx-color-on-primary"]).toBe("#ffffff");
  });

  it("keeps the same fixed accent whatever the company record contains", () => {
    const empty = themeRowToCssVars({});
    const coloured = themeRowToCssVars({
      primary_color: "#0a7d4b",
      accent_color: "#ff0000"
    });
    expect(empty["--nx-color-accent"]).toBe(DEFAULT_ACCENT);
    expect(coloured["--nx-color-accent"]).toBe(DEFAULT_ACCENT);
    expect(Object.hasOwn(empty, "--nx-color-primary")).toBe(false);
    expect(Object.hasOwn(coloured, "--nx-color-primary")).toBe(true);
  });

  it("records the change of direction with its reason and date", () => {
    // Vision RULE 16.4.1 - a rule that changes is written down with its
    // reason and dated, rather than silently changed.
    expect(CHANGE_LOG_2026_10_22_SINGLE_NEXORA_BRAND).toMatch(/2026-10-22/);
    expect(CHANGE_LOG_2026_10_22_SINGLE_NEXORA_BRAND).toMatch(/Rationale/);
  });

  it("wraps the stored font family in the standard fallback stack", () => {
    const vars = themeRowToCssVars({ font_family: "Poppins" });
    expect(vars["--nx-font-family"]).toBe('"Poppins", system-ui, -apple-system, "Segoe UI", sans-serif');
  });

  it("enforces the #RRGGBB brand color grammar", () => {
    expect(HEX_COLOR_RE.test("#2547e0")).toBe(true);
    expect(HEX_COLOR_RE.test("#FFF")).toBe(false);
    expect(HEX_COLOR_RE.test("2547e0")).toBe(false);
    expect(HEX_COLOR_RE.test("#2547e0ff")).toBe(false);
    expect(HEX_COLOR_RE.test("#GGGGGG")).toBe(false);
  });

  it("drops a stored colour that is not strict #RRGGBB", () => {
    // RULE 13.8.1 - a themed element may only come from the theme record, and
    // the record is untrusted input, so a malformed value must never reach a
    // custom property where it could close the declaration.
    const vars = themeRowToCssVars({
      secondary_color: "red; } body { display:none } .x {",
      navy_color: "url(evil)",
      primary_color: "#0a7d4b"
    });
    expect(Object.hasOwn(vars, "--nx-color-secondary")).toBe(false);
    expect(Object.hasOwn(vars, "--nx-color-navy")).toBe(false);
    expect(vars["--nx-color-primary"]).toBe("#0a7d4b");
  });

  it("quotes each family in a comma-separated font stack", () => {
    const vars = themeRowToCssVars({ font_family: "Fraunces, Georgia" });
    expect(vars["--nx-font-family"]).toBe(
      '"Fraunces", "Georgia", system-ui, -apple-system, "Segoe UI", sans-serif'
    );
  });

  it("never quotes a CSS generic family keyword", () => {
    const vars = themeRowToCssVars({ font_family: "Inter, sans-serif" });
    expect(vars["--nx-font-family"]).toBe(
      '"Inter", sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif'
    );
  });

  it("drops a font family that could escape the declaration", () => {
    for (const bad of [
      'Poppins"; } body { display:none } .x {',
      'Poppins"',
      "Poppins } .evil {",
      "Poppins; color: red",
      ""
    ]) {
      const vars = themeRowToCssVars({ font_family: bad });
      expect(Object.hasOwn(vars, "--nx-font-family")).toBe(false);
    }
  });
});
