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

  it("passes stored colors through verbatim", () => {
    const vars = themeRowToCssVars({
      primary_color: "#112233",
      secondary_color: "#ffffff",
      accent_color: "#f59e0b",
      navy_color: "#0b1f4b"
    });
    expect(vars).toEqual({
      "--nx-color-primary": "#112233",
      "--nx-color-secondary": "#ffffff",
      "--nx-color-accent": "#f59e0b",
      "--nx-color-navy": "#0b1f4b"
    });
  });

  it("skips null/absent tokens so stylesheet Nexora defaults remain in effect", () => {
    const vars = themeRowToCssVars({ primary_color: null, accent_color: undefined });
    expect(vars).toEqual({});
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
});
