import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const stylesPath = fileURLToPath(new globalThis.URL("../src/styles.css", import.meta.url));
const sourceRoot = fileURLToPath(new globalThis.URL("../src", import.meta.url));
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
/**
 * 读取时统一行尾。这些契约检查的是导入顺序、令牌与选择器，与行尾风格无关；
 * 而 git 的 autocrlf 会在 Windows 检出时把工作区换成 CRLF，
 * 若按原始字节比较，任何 Windows 全新克隆都会失败。
 */
function readStyle(path) {
  return existsSync(path) ? readFileSync(path, "utf8").replace(/\r\n/g, "\n") : "";
}

const stylesCss = readStyle(stylesPath);
const tokensCss = readStyle(tokensPath);
const foundationCss = readStyle(foundationPath);
const themesCss = readStyle(themesPath);
const featureStyles = Object.fromEntries(
  FEATURE_STYLE_FILES.map(([domain, relativePath]) => [
    domain,
    readStyle(fileURLToPath(new globalThis.URL(relativePath, import.meta.url))),
  ]),
);
const featureCss = Object.values(featureStyles).join("\n");
const implementationCss = `${themesCss}\n${foundationCss}\n${featureCss}`;

function readReactSources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return readReactSources(path);
    if (!/\.tsx?$/.test(entry.name) || entry.name.includes(".test.")) return [];
    return [readFileSync(path, "utf8")];
  });
}

const reactSource = readReactSources(sourceRoot).join("\n");

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

const REQUIRED_MOTION_TOKENS = [
  ["--duration-fast", "150ms"],
  ["--duration-normal", "200ms"],
  ["--duration-slow", "300ms"],
  ["--duration-status-cycle", "1200ms"],
  ["--ease-out", "cubic-bezier(0.4, 0, 0.2, 1)"],
  ["--ease-in-out", "cubic-bezier(0.4, 0, 0.2, 1)"],
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

  it("defines a shared motion scale with restrained interaction durations", () => {
    const rootBlock = extractRootBlock(tokensCss);

    for (const [token, value] of REQUIRED_MOTION_TOKENS) {
      expect(rootBlock, `${token} should be defined in :root`).toContain(
        `${token}: ${value};`,
      );
    }
  });

  it("limits transitions to tokenized opacity and transform motion", () => {
    expect(`${implementationCss}\n${reactSource}`).not.toMatch(
      /\btransition\s*:\s*[^;{}]*\ball\b/i,
    );

    const transitionDeclarations = [...implementationCss.matchAll(/\btransition\s*:\s*([^;{}]+)/gi)]
      .flatMap((match) => match[1].split(","))
      .map((declaration) => declaration.trim());

    expect(transitionDeclarations.length).toBeGreaterThan(0);
    for (const declaration of transitionDeclarations) {
      expect(declaration).toMatch(
        /^(?:opacity|transform)\s+var\(--duration-(?:fast|normal|slow)\)\s+var\(--ease-(?:out|in-out)\)$/,
      );
    }
  });

  it("keeps continuous animation functional and tokenized", () => {
    expect(featureStyles.shell).toMatch(
      /animation:\s*model-status-pulse\s+var\(--duration-status-cycle\)\s+var\(--ease-in-out\)\s+infinite/,
    );
    expect(featureStyles.evolution).not.toMatch(/@keyframes\s+(?:strokeFlow|pulseGlow)\b/);

    const continuousAnimations = [
      ...implementationCss.matchAll(/\banimation\s*:\s*([^;{}]*\binfinite\b[^;{}]*)/gi),
    ].map((match) => match[1].trim());
    expect(continuousAnimations.length).toBeGreaterThan(0);
    for (const declaration of continuousAnimations) {
      expect(declaration).toMatch(/(?:status|loading|skeleton|progress)/i);
      expect(declaration).toMatch(/var\(--duration-[\w-]+\)/);
    }

    const hardcodedAnimationDurations = implementationCss.match(
      /\banimation\s*:[^;{}]*\b\d+(?:\.\d+)?m?s\b/gi,
    );
    expect(hardcodedAnimationDurations ?? []).toEqual([]);
  });

  it("provides a global reduced-motion fallback", () => {
    expect(featureStyles.responsive).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)/,
    );
    expect(featureStyles.responsive).toMatch(
      /animation-duration:\s*0\.01ms\s*!important/,
    );
    expect(featureStyles.responsive).toMatch(
      /animation-iteration-count:\s*1\s*!important/,
    );
    expect(featureStyles.responsive).toMatch(
      /transition-duration:\s*0\.01ms\s*!important/,
    );
  });

  it("keeps literal colors inside the root token definition", () => {
    const literalColors = `${implementationCss}\n${reactSource}`.match(
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
    expect(`${implementationCss}\n${reactSource}`).not.toMatch(
      /\b(?:linear|radial)-gradient\(/i,
    );
  });

  it("keeps product styling out of React style blocks", () => {
    expect(reactSource).not.toMatch(/<style\b/i);
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

  it("keeps viewport and container queries in the responsive domain", () => {
    for (const domain of ["shell", "agent", "inspector", "evolution"]) {
      expect(featureStyles[domain], `${domain}.css should not own responsive queries`).not.toMatch(
        /@(?:media|container)\b/,
      );
    }
    expect(featureStyles.responsive).toMatch(/@container\b/);
  });
});
