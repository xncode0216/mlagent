import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const stylesPath = fileURLToPath(new globalThis.URL("../src/styles.css", import.meta.url));
const tokensPath = fileURLToPath(
  new globalThis.URL("../src/styles/tokens.css", import.meta.url),
);
const foundationPath = fileURLToPath(
  new globalThis.URL("../src/styles/foundation.css", import.meta.url),
);
const stylesCss = readFileSync(stylesPath, "utf8");
const tokensCss = existsSync(tokensPath) ? readFileSync(tokensPath, "utf8") : "";
const foundationCss = existsSync(foundationPath)
  ? readFileSync(foundationPath, "utf8")
  : "";

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

const REQUIRED_FOUNDATION_TOKENS = [
  "--space-1",
  "--space-2",
  "--space-3",
  "--space-4",
  "--space-5",
  "--space-6",
  "--space-8",
  "--space-10",
  "--space-12",
  "--radius-sm",
  "--radius-control",
  "--radius-panel",
  "--radius-pill",
  "--radius-round",
  "--layer-popover",
];

const RETIRED_SELECTORS = [
  "analysis-grid",
  "code-panel",
  "code-preview",
  "compact-table",
  "correlation-grid",
  "heatmap-grid",
  "histogram",
  "plan-card",
  "plan-grid",
  "visual-card",
  "workbench-card",
];

function extractRootBlock(css) {
  return css.match(/:root\s*\{[^}]*\}/s)?.[0] ?? "";
}

describe("global design-token contract", () => {
  it("loads dedicated token and foundation layers before feature styles", () => {
    expect(stylesCss).toMatch(
      /^@import\s+["']\.\/styles\/tokens\.css["'];\s*@import\s+["']\.\/styles\/foundation\.css["'];/,
    );
    expect(tokensCss).not.toBe("");
    expect(foundationCss).not.toBe("");
  });

  it("defines the required semantic Catppuccin color tokens", () => {
    const rootBlock = extractRootBlock(tokensCss);

    for (const token of REQUIRED_COLOR_TOKENS) {
      expect(rootBlock, `${token} should be defined in :root`).toContain(`${token}:`);
    }
  });

  it("defines the shared spacing, radius, and layer scale", () => {
    const rootBlock = extractRootBlock(tokensCss);

    for (const token of REQUIRED_FOUNDATION_TOKENS) {
      expect(rootBlock, `${token} should be defined in :root`).toContain(`${token}:`);
    }
  });

  it("keeps literal colors inside the root token definition", () => {
    const literalColors = `${foundationCss}\n${stylesCss}`.match(
      /#[\da-f]{3,8}\b|rgba?\(\s*\d|hsla?\(\s*\d|:\s*(?:black|white)\b/gi,
    );

    expect(literalColors ?? []).toEqual([]);
  });

  it("uses tokens for spacing, radius, and stacking declarations", () => {
    const implementationCss = `${foundationCss}\n${stylesCss}`;
    const literalSpacing = implementationCss.match(
      /\b(?:gap|row-gap|column-gap|padding(?:-(?:top|right|bottom|left))?|margin(?:-(?:top|right|bottom|left))?)\s*:[^;{}]*-?\d+(?:\.\d+)?px\b/gi,
    );
    const literalRadii = implementationCss.match(
      /\bborder-radius\s*:[^;{}]*(?:\d+(?:\.\d+)?px|\d+%)/gi,
    );
    const literalLayers = implementationCss.match(/\bz-index\s*:\s*\d+/gi);

    expect(literalSpacing ?? []).toEqual([]);
    expect(literalRadii ?? []).toEqual([]);
    expect(literalLayers ?? []).toEqual([]);
  });

  it("does not keep selectors retired with the removed demo surfaces", () => {
    for (const selector of RETIRED_SELECTORS) {
      const selectorPattern = new RegExp(`\\.${selector}(?![\\w-])`);
      expect(stylesCss, `.${selector} should be removed`).not.toMatch(selectorPattern);
    }
  });

  it("does not use decorative CSS gradients", () => {
    expect(stylesCss).not.toMatch(/\b(?:linear|radial)-gradient\(/i);
  });
});
