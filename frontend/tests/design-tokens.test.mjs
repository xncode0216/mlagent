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
const themesPath = fileURLToPath(
  new globalThis.URL("../src/styles/themes.css", import.meta.url),
);
const FEATURE_STYLE_FILES = [
  ["shell", "../src/styles/shell.css"],
  ["agent", "../src/styles/agent.css"],
  ["inspector", "../src/styles/inspector.css"],
  ["evolution", "../src/styles/evolution.css"],
  ["responsive", "../src/styles/responsive.css"],
];
const stylesCss = readFileSync(stylesPath, "utf8");
const tokensCss = existsSync(tokensPath) ? readFileSync(tokensPath, "utf8") : "";
const foundationCss = existsSync(foundationPath)
  ? readFileSync(foundationPath, "utf8")
  : "";
const themesCss = existsSync(themesPath) ? readFileSync(themesPath, "utf8") : "";
const featureStyles = Object.fromEntries(
  FEATURE_STYLE_FILES.map(([domain, relativePath]) => {
    const path = fileURLToPath(new globalThis.URL(relativePath, import.meta.url));
    return [domain, existsSync(path) ? readFileSync(path, "utf8") : ""];
  }),
);
const featureCss = Object.values(featureStyles).join("\n");
const implementationCss = `${themesCss}\n${foundationCss}\n${featureCss}`;

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

function extractDefaultThemeBlock(css) {
  return (
    css.match(
      /:root\s*,\s*\[data-theme=["']catppuccin-mocha["']\]\s*\{[^}]*\}/s,
    )?.[0] ?? ""
  );
}

describe("global design-token contract", () => {
  it("loads token, theme, foundation, and product-domain layers in order", () => {
    expect(stylesCss.trim()).toBe(
      [
        '@import "./styles/tokens.css";',
        '@import "./styles/themes.css";',
        '@import "./styles/foundation.css";',
        '@import "./styles/shell.css";',
        '@import "./styles/agent.css";',
        '@import "./styles/inspector.css";',
        '@import "./styles/evolution.css";',
        '@import "./styles/responsive.css";',
      ].join("\n"),
    );
    expect(tokensCss).not.toBe("");
    expect(themesCss).not.toBe("");
    expect(foundationCss).not.toBe("");
  });

  it("defines the required semantic Catppuccin color tokens", () => {
    const rootBlock = extractDefaultThemeBlock(themesCss);

    for (const token of REQUIRED_COLOR_TOKENS) {
      expect(rootBlock, `${token} should be defined in :root`).toContain(`${token}:`);
    }
  });

  it("provides explicit theme and brand-accent override hooks", () => {
    expect(themesCss).toMatch(/:root\s*,\s*\[data-theme=["']catppuccin-mocha["']\]/);
    expect(themesCss).toMatch(/\[data-brand-accent=["']ml["']\]\s*\{/);
    expect(themesCss).toMatch(
      /\[data-brand-accent=["']ml["']\][^{]*\{[^}]*--color-accent:\s*var\(--palette-ml\)/s,
    );
  });

  it("defines the shared spacing, radius, and layer scale", () => {
    const rootBlock = extractRootBlock(tokensCss);

    for (const token of REQUIRED_FOUNDATION_TOKENS) {
      expect(rootBlock, `${token} should be defined in :root`).toContain(`${token}:`);
    }
  });

  it("keeps literal colors inside the root token definition", () => {
    const literalColors = implementationCss.match(
      /#[\da-f]{3,8}\b|rgba?\(\s*\d|hsla?\(\s*\d|:\s*(?:black|white)\b/gi,
    );

    expect(literalColors ?? []).toEqual([]);
  });

  it("uses tokens for spacing, radius, and stacking declarations", () => {
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
      expect(featureCss, `.${selector} should be removed`).not.toMatch(selectorPattern);
    }
  });

  it("does not use decorative CSS gradients", () => {
    expect(implementationCss).not.toMatch(/\b(?:linear|radial)-gradient\(/i);
  });

  it("keeps each product domain in a dedicated non-empty stylesheet", () => {
    expect(featureStyles.shell).toMatch(/\.app-shell\s*\{/);
    expect(featureStyles.shell).toMatch(/\.file-sidebar\s*\{/);
    expect(featureStyles.agent).toMatch(/\.agent-header\s*\{/);
    expect(featureStyles.agent).toMatch(/\.markdown-body\s*\{/);
    expect(featureStyles.inspector).toMatch(/\.right-tabs\s*\{/);
    expect(featureStyles.inspector).toMatch(/\.training-panel\s*\{/);
    expect(featureStyles.evolution).toMatch(/\.evolution-workspace\s*\{/);
    expect(featureStyles.evolution).toMatch(/\.knowledge-graph-mini\s*\{/);
    expect(featureStyles.responsive).toMatch(/@media\s*\(max-width:\s*1180px\)/);
  });
});
