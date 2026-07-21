import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const stylesPath = fileURLToPath(new globalThis.URL("../src/styles.css", import.meta.url));
const stylesCss = readFileSync(stylesPath, "utf8");

const REQUIRED_COLOR_TOKENS = [
  "--color-bg-canvas",
  "--color-bg-surface",
  "--color-bg-raised",
  "--color-bg-overlay",
  "--color-border",
  "--color-border-strong",
  "--color-text",
  "--color-text-subtle",
  "--color-text-muted",
  "--color-accent",
  "--color-success",
  "--color-warning",
  "--color-danger",
  "--color-ml",
];

function extractRootBlock(css) {
  return css.match(/:root\s*\{[^}]*\}/s)?.[0] ?? "";
}

describe("global design-token contract", () => {
  it("defines the required semantic Catppuccin color tokens", () => {
    const rootBlock = extractRootBlock(stylesCss);

    for (const token of REQUIRED_COLOR_TOKENS) {
      expect(rootBlock, `${token} should be defined in :root`).toContain(`${token}:`);
    }
  });

  it("keeps literal colors inside the root token definition", () => {
    const cssWithoutRoot = stylesCss.replace(extractRootBlock(stylesCss), "");
    const literalColors = cssWithoutRoot.match(
      /#[\da-f]{3,8}\b|rgba?\(\s*\d|hsla?\(\s*\d|:\s*(?:black|white)\b/gi,
    );

    expect(literalColors ?? []).toEqual([]);
  });

  it("does not use decorative CSS gradients", () => {
    expect(stylesCss).not.toMatch(/\b(?:linear|radial)-gradient\(/i);
  });
});
