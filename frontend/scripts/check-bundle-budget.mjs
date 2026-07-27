#!/usr/bin/env node
/* global URL, console, process */
// 构建产物预算门禁。
//
// 目的不是追求最小体积，而是防止两类无声回归：
//   1. 首屏主包随业务代码增长而慢慢膨胀；
//   2. 分包配置把本应按需加载的重依赖（cytoscape / recharts / react-markdown）
//      提升为首屏 chunk —— 一次 manualChunks 实验已真实复现过该问题。
//
// 预算基于 2026-07-27 实测值设定，留有小幅余量；超出即失败，需要显式复核后调整。

import { gzipSync } from "node:zlib";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const distRoot = fileURLToPath(new URL("../dist", import.meta.url));
const assetsRoot = join(distRoot, "assets");

// 与 Vite 构建输出保持同一进制，便于直接对照报告数字
const KB = 1000;

const BUDGETS = {
  // 首屏必须下载的字节数（index.html 直接引用或 modulepreload 的资源）
  initialJsGzip: 140 * KB,
  initialJsRaw: 490 * KB,
  initialCssGzip: 16 * KB,
  // 单个 chunk 上限，与 Vite 默认告警线一致，防止新增巨型依赖
  anyChunkRaw: 500 * KB,
  // 首屏 JS 请求数：当前为 1，放宽到 3 以容纳合理的 vendor 拆分
  initialJsFiles: 3,
};

// 这些 chunk 承载重依赖，必须保持按需加载，不得出现在首屏引用中
const MUST_STAY_LAZY = [
  "KnowledgeGraphCanvas",
  "MarkdownMessage",
  "HistogramChart",
  "EvolutionWorkspace",
];

function formatKb(bytes) {
  return `${(bytes / KB).toFixed(2)}kB`;
}

function readAsset(name) {
  const path = join(assetsRoot, name);
  const raw = readFileSync(path);
  return { name, raw: raw.length, gzip: gzipSync(raw).length };
}

function collectInitialAssets(html) {
  // <script src>、<link rel="stylesheet" href>、<link rel="modulepreload" href>
  const references = [...html.matchAll(/(?:src|href)="\/assets\/([^"]+)"/g)].map(
    (match) => match[1],
  );
  return [...new Set(references)];
}

function main() {
  let html;
  try {
    html = readFileSync(join(distRoot, "index.html"), "utf8");
  } catch {
    console.error("✗ 未找到 dist/index.html，请先运行 vite build。");
    process.exit(1);
  }

  const initialNames = collectInitialAssets(html);
  const initialJs = initialNames.filter((name) => name.endsWith(".js")).map(readAsset);
  const initialCss = initialNames.filter((name) => name.endsWith(".css")).map(readAsset);

  const allChunks = readdirSync(assetsRoot)
    .filter((name) => name.endsWith(".js") && statSync(join(assetsRoot, name)).isFile())
    .map(readAsset);

  const sum = (assets, key) => assets.reduce((total, asset) => total + asset[key], 0);
  const initialJsRaw = sum(initialJs, "raw");
  const initialJsGzip = sum(initialJs, "gzip");
  const initialCssGzip = sum(initialCss, "gzip");

  const failures = [];

  if (initialJsGzip > BUDGETS.initialJsGzip) {
    failures.push(
      `首屏 JS gzip ${formatKb(initialJsGzip)} 超出预算 ${formatKb(BUDGETS.initialJsGzip)}`,
    );
  }
  if (initialJsRaw > BUDGETS.initialJsRaw) {
    failures.push(
      `首屏 JS 原始 ${formatKb(initialJsRaw)} 超出预算 ${formatKb(BUDGETS.initialJsRaw)}`,
    );
  }
  if (initialCssGzip > BUDGETS.initialCssGzip) {
    failures.push(
      `首屏 CSS gzip ${formatKb(initialCssGzip)} 超出预算 ${formatKb(BUDGETS.initialCssGzip)}`,
    );
  }
  if (initialJs.length > BUDGETS.initialJsFiles) {
    failures.push(
      `首屏 JS chunk 数 ${initialJs.length} 超出预算 ${BUDGETS.initialJsFiles}`,
    );
  }

  for (const chunk of allChunks) {
    if (chunk.raw > BUDGETS.anyChunkRaw) {
      failures.push(`chunk ${chunk.name} 原始 ${formatKb(chunk.raw)} 超出单包上限 ${formatKb(BUDGETS.anyChunkRaw)}`);
    }
  }

  for (const lazyName of MUST_STAY_LAZY) {
    const leaked = initialJs.find((asset) => asset.name.startsWith(`${lazyName}-`));
    if (leaked) {
      failures.push(`${lazyName} 应保持按需加载，但已被首屏引用（${leaked.name}）`);
    }
    const exists = allChunks.some((asset) => asset.name.startsWith(`${lazyName}-`));
    if (!exists) {
      failures.push(`未找到 ${lazyName} 的独立 chunk，懒加载边界可能已被合并`);
    }
  }

  console.log("构建产物预算：");
  console.log(
    `  首屏 JS   ${formatKb(initialJsRaw)} / gzip ${formatKb(initialJsGzip)}  (${initialJs.length} chunk，预算 gzip ${formatKb(BUDGETS.initialJsGzip)})`,
  );
  console.log(
    `  首屏 CSS  gzip ${formatKb(initialCssGzip)}  (预算 ${formatKb(BUDGETS.initialCssGzip)})`,
  );
  console.log(`  按需 chunk ${allChunks.length - initialJs.length} 个，保持懒加载`);

  if (failures.length > 0) {
    console.error("\n✗ 构建产物超出预算：");
    for (const failure of failures) console.error(`  - ${failure}`);
    console.error("\n如为有意增长，请复核后调整 scripts/check-bundle-budget.mjs 中的预算。");
    process.exit(1);
  }

  console.log("\n✓ 构建产物在预算内。");
}

main();
