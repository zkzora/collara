// WCAG 1.4.11 (non-text contrast): form-control boundaries need >= 3:1 against the adjacent colors. axe does not
// check this, so the tokens are verified numerically here from globals.css, and the shared controls are checked
// to draw their boundary with the token (not the translucent decorative --line-* values, about 1.2-1.6:1).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
const css = read("./globals.css");

/** The declarations of the rule whose selector list ends with `selector`. */
function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no rule for ${selector}`);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
}

function rgb(value: string): [number, number, number] {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (!hex) throw new Error(`expected an opaque #rrggbb color, got ${value}`);
  const n = Number.parseInt(hex[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(rgb(a)), luminance(rgb(b))].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const SURFACES = ["surface-page", "surface-nav", "surface-sunken", "surface-1", "surface-2"] as const;

describe("form-control boundary tokens (WCAG 1.4.11)", () => {
  for (const [name, selector] of [
    ["app (and :root: dialogs, popups)", '[data-surface="app"]'],
    ["marketing", '[data-surface="marketing"]'],
  ] as const) {
    it(`${name}: --line-input and --line-input-hover reach 3:1 on every surface`, () => {
      const tokens = block(selector);
      let checked = 0;
      for (const surface of SURFACES) {
        const background = tokens[surface];
        // Translucent headers are not a control background; inputs sit on the opaque surfaces.
        if (!background || !background.startsWith("#")) continue;
        checked += 1;
        for (const border of ["line-input", "line-input-hover"]) {
          const ratio = contrast(tokens[border]!, background);
          expect(ratio, `${border} on ${surface} (${background}) = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
        }
      }
      expect(checked).toBe(SURFACES.length);
    });
  }

  it("the translucent decorative lines stay below 3:1 (so they must not draw control boundaries)", () => {
    // white at 12% over the app sunken surface ≈ #2d2e32: 1.38:1.
    expect(contrast("#2d2e32", "#0f1014")).toBeLessThan(3);
  });

  it("the shared controls draw their boundary with the token", () => {
    for (const file of [
      "../components/ui/input.tsx",
      "../components/ui/textarea.tsx",
      "../components/ui/select.tsx",
      "../components/ui/checkbox.tsx",
      "../components/ui/radio-group.tsx",
      "../components/workspace/form-fields.tsx",
    ]) {
      const source = read(file);
      expect(source, file).toContain("border-line-input");
      expect(source, file).not.toMatch(/\bborder-input\b|\bborder-line-strong\b|\bborder-line-control\b/);
    }
  });
});
