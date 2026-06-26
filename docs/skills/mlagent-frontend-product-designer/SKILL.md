---
name: mlagent-frontend-product-designer
description: MLAgent-specific frontend product design and optimization skill for product-grade React UI/UX work. Use when Codex designs, reviews, implements, or polishes MLAgent frontend screens, interactions, navigation, sidebars, right panels, data/ML workflows, knowledge graph UI, settings, accessibility, responsive behavior, visual hierarchy, or any frontend change that affects user experience.
---

# MLAgent Frontend Product Designer

## Mission

Turn MLAgent's frontend into a product-grade AI/data/ML workbench: operational, dense but calm, inspectable, accessible, and wired end-to-end. Optimize real workflows before decoration.

### 必读参考资产

对于每个前端任务，按需查阅以下参考文件：

| 优先级 | 文件 | 何时查阅 |
|--------|------|---------|
| **P0** | `docs/design-references/impeccable-antipatterns.md` | 任何 UI 变更前 — 避免 AI-slop 设计 |
| **P0** | `references/product-ui-principles.md` | 布局、交互、可访问性或视觉系统决策 |
| **P1** | `docs/design-references/linear-design.md` | 紧凑操作 UI、命令面板、列表行设计 |
| **P1** | `docs/design-references/cursor-design.md` | IDE 编辑器风格、代码面板、多面板布局 |
| **P2** | `docs/design-references/supabase-design.md` | 数据仪表板、数据表、分析面板 |
| **P2** | `docs/ui-patterns/animation-patterns.md` | 状态过渡动效、微交互、骨架屏 |

## Operating Model

Act as the frontend optimization agent for MLAgent. For every frontend-related task:

1. Read current product context: `task_plan.md`, `progress.md`, `design-spec.md`, relevant docs under `docs/`, and the affected React/CSS/API files.
2. Identify the user workflow being improved, not just the component being edited.
3. Map each visible control to a state transition, backend/API contract, route, artifact, or clearly staged placeholder.
4. Implement one testable vertical slice. Prefer real behavior over new chrome.
5. Verify with lint, tests/build when feasible, and browser smoke checks for visible UI changes.
6. Update project progress/plans when the work changes product behavior or follow-up priorities.

## MLAgent UI Shape

Preserve the app-workbench structure unless the task explicitly redesigns it:

- Top nav: product identity, major modes, service/model context.
- Left activity rail and sidebar: project, files, search, data, experiments, knowledge, settings.
- Center workspace: active agent workflow and primary task surface.
- Right panel: contextual artifacts, data preview, training metrics, logs, graph/run details.
- Status bar: connection, project/session, active file, artifacts, GPU/resource state.

Keep controls near their domain: file operations in file/data panels, training controls in ML panels, lesson review in evolution surfaces, runtime settings in settings.

## Design Rules

### 核心布局
- Make the first viewport a usable work surface, not a landing page.
- Favor compact, scannable operational UI over hero blocks, nested cards, or decorative panels.
- Fit text inside its container on desktop and mobile; long file paths and IDs must wrap gracefully.
- Prefer direct manipulation and deep links: clicking graph evidence, artifacts, runs, or files should select the canonical object in the app.

### 控件与状态
- Use icons for known actions, tabs for view groups, segmented controls for modes, toggles for binary choices, tables for comparisons, and menus for option sets.
- Use clear active, hover, disabled, loading, empty, success, and error states.
- Keep table rows, buttons, code paths, and panel headers stable in size; avoid layout shift.

### 色彩与视觉
- Use restrained color: neutral structure, semantic status colors, and sparse accents for attention.
- Avoid one-note palettes, decorative blobs/orbs, marketing-style gradients, and UI cards inside UI cards.
- **全部颜色来自 Catppuccin 暗色 token 体系**。禁止纯黑 (`#000`)、纯灰 (`#808080`)、或灰色文字在彩色背景上。
- 强调色 (Accent blue `#89b4fa`) 仅用于主交互元素，不得滥用。

### 动画约束（参考 `docs/ui-patterns/animation-patterns.md`）
- 动画时长 150-300ms，使用标准缓出函数
- 仅动画 `opacity` 和 `transform`（GPU 加速属性）
- 动效必须有功能意义：状态过渡、反馈确认、焦点引导
- **禁止** bounce/elastic 缓动、无限循环装饰动画、在 `:hover` 时启动关键帧动画
- **必须** 包含 `prefers-reduced-motion` 回退

### 设计反模式（详见 `docs/design-references/impeccable-antipatterns.md`）
- ❌ 不使用 Arial/Inter/Roboto 之外的默认 AI 字体（项目锁定 Inter + JetBrains Mono）
- ❌ 不嵌套卡片，不把一切包裹为卡片
- ❌ 不使用 emoji 作为功能图标（锁定 lucide-react）
- ❌ 不使用 Lorem Ipsum 或 AI 编造的假数据
- ❌ 不依赖颜色作为唯一状态区分方式
- ✅ 所有可交互元素 ≥ 44×44px 触控目标
- ✅ 所有可交互元素有可见的 `:focus-visible` 样式

### 品牌设计哲学（参考 `docs/design-references/`）
- **Linear 式操作密度**: 紧凑列表行（~36-40px）、悬停显露操作按钮、键盘驱动工作流、极简视觉
- **Cursor 式编辑冷静**: 代码优先视觉、细线分割而非阴影、展示字重不走 bold、单一强调色策略
- **Supabase 式数据清晰**: 紧凑数据面板、产品界面即装饰、按钮方形化不做药丸形

## Interaction Workflow

When optimizing a screen:

1. Inventory controls and states.
   - List visible controls mentally: buttons, tabs, form fields, tables, icons, graph nodes, rows.
   - Identify no-op controls and either wire them or make a deliberate staged state.

2. Close the loop.
   - Mutations must refresh affected state: file tree, active file, artifacts, sessions, lessons, runs, logs, GPU status.
   - Generated artifacts should be visible and navigable from the UI.
   - Cross-surface actions should land on the canonical panel and highlight the object.

3. Handle failure.
   - Show errors close to the action that caused them.
   - Preserve successful context when a refresh fails.
   - Disable only the action that is unsafe during async work.

4. Validate accessibility.
   - Preserve keyboard reachability for tabs, graph nodes, activity buttons, dialogs, and form fields.
   - Keep labels, aria labels, focus states, and target sizes meaningful.
   - Do not rely on color alone for selected/error/status states.

5. Verify visually.
   - Use the in-app browser for local frontend QA when available.
   - If full-page screenshot times out, validate DOM state and try a narrower browser/CLI fallback.

## Implementation Preferences

- Follow existing React and CSS patterns before adding abstractions.
- Prefer typed props and small pure helpers for behavior that deserves tests.
- Keep CSS in the existing style system (`frontend/src/styles.css`) unless a local component already owns scoped styles.
- Add tests for formatters, navigation helpers, rail/panel configs, reducers, and API contracts.
- Use lucide icons already in the project when a familiar icon exists.
- Do not introduce a new UI framework unless the product plan explicitly calls for it.
- **绝对禁止**: 引入 Tailwind CSS、shadcn/ui、MUI、Ant Design 或任何第三方 UI 组件库。
- 任何新增 CSS 必须使用 Catppuccin token（参见 `docs/design/design-system.html` 和 `design-spec.md`）。

## Completion Checklist

Before reporting completion, confirm:

- The primary user workflow works from the visible UI.
- No newly visible control is accidentally inert.
- Loading, empty, error, and selected states are present where relevant.
- The layout remains readable at common desktop widths and does not break on narrower widths.
- `npm.cmd run lint`, `npm.cmd test`, and `npm.cmd run build` pass when frontend code changed, or any skipped verification is explained.
- Browser QA covers the changed interaction when a dev server is running.
- Progress/planning docs reflect the new product capability and next step.
