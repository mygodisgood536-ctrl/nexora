import { describe, expect, it } from "vitest";
import { HEX_COLOR_RE, THEME_VAR_MAP, themeRowToCssVars } from "../src/theme";

describe("theme token architecture", () => {
  it("maps every themed column to its --nx-* CSS custom property", () => {
    expect(THEME_VAR_MAP.primary_color).toBe("--nx-color-primary");
    expect(THEME_VAR_MAP.secondary_color).toBe("--nx-color-secondary");
    expect(THEME_VAR_MAP.accent_color).toBe("--nx-color-accent");
    expect(THEME_VAR_MAP.navy_color).toBe("--nx-color-navy");
    expect(THEME_VAR_MAP.font_family).toBe("--nx-font-family");
  });

  it("passes stored colors through verbatim and derives the accent from the primary", () => {
    const vars = themeRowToCssVars({
      primary_color: "#112233",
      secondary_color: "#ffffff",
      accent_color: "#f59e0b",
      navy_color: "#0b1f4b"
    });
    expect(vars).toEqual({
      "--nx-color-primary": "#112233",
      "--nx-color-secondary": "#ffffff",
      // RULE 13.4.3 — the company's chosen colour drives every accent element.
      "--nx-color-accent": "#112233",
      "--nx-color-navy": "#0b1f4b",
      // RULE 13.5.1 — the label on the accent is computed, never chosen.
      "--nx-color-on-primary": "#ffffff"
    });
  });

  it("falls back to the stored accent colour when no primary is stored", () => {
    const vars = themeRowToCssVars({ primary_color: null, accent_color: "#0a7d4b" });
    expect(vars["--nx-color-accent"]).toBe("#0a7d4b");
    expect(vars["--nx-color-on-primary"]).toBe("#ffffff");
    expect(Object.hasOwn(vars, "--nx-color-primary")).toBe(false);
  });

  it("keeps the neutral black accent when no company colour is stored at all", () => {
    const vars = themeRowToCssVars({ primary_color: null, accent_color: undefined });
    expect(vars["--nx-color-accent"]).toBe("#111111");
    expect(vars["--nx-color-on-primary"]).toBe("#ffffff");
    expect(Object.hasOwn(vars, "--nx-color-primary")).toBe(false);
    expect(Object.hasOwn(themeRowToCssVars({}), "--nx-color-primary")).toBe(false);
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
