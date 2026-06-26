# MLAgent — Claude Code 项目配置

## 项目身份

**MLAgent** 是一个 AI IDE 风格的数据科学与机器学习智能体 Web 工作台。核心理念：对话驱动分析 + 代码执行 + 自进化经验系统。

## 技术约束（不可违背）

### 前端架构
- **框架**: React 19 + TypeScript + Vite
- **样式**: **纯 CSS**（`frontend/src/styles.css`），Catppuccin 暗色主题
- **绝对禁止**: 引入 Tailwind CSS、shadcn/ui、MUI、Ant Design 或任何第三方 UI 组件库
- **唯一 UI 依赖**: lucide-react（图标库），Zustand（状态管理），React Query（数据获取）
- **不引入新的 npm UI 依赖**，除非 task_plan.md 明确规划

### 设计系统
- **色彩**: Catppuccin Mocha 暗色主题 token 体系
  - Base: `#0a0a0f`, Surface: `#11111b`, Overlay: `#1e1e2e`
  - Border: `#313244`, Text: `#cdd6f4`, Subtext: `#a6adc8`, Muted: `#6c7086`
  - Accent: `#89b4fa`(蓝), ML: `#cba6f7`(紫), Success: `#a6e3a1`(绿), Warn: `#fab387`(橙)
- **字体**: UI 用 Inter（system-ui 回退），代码用 JetBrains Mono（monospace 回退）
- **布局**: CSS Grid 四列三行（48px | 286px | 1fr | 420px）+ 顶部48px + 底部28px
- **圆角**: 6-8px，无装饰性渐变、无嵌套卡片
- 详细设计规范见 `design-spec.md` 和 `docs/design/design-system.html`

## 设计质量护栏

### 品牌参考资产
设计决策时参考以下品牌的设计系统（详见 `docs/design-references/`）：
- **Linear** — 紧凑操作 UI、最小化设计、键盘驱动工作流
- **Cursor** — AI IDE 编辑器风格、暖色调深色主题、代码优先视觉
- **Supabase** — 数据仪表板模式、技术向保守配色、产品截图叙事

### 反模式禁止
遵循 `docs/design-references/impeccable-antipatterns.md` 中的设计反模式规则。核心禁止项：
- 不使用 Arial/Inter/Roboto 等 AI 生成 UI 的默认字体（项目已锁定 Inter + JetBrains Mono）
- 不使用灰色文字在彩色背景上
- 不使用纯黑(`#000`)或纯灰(`#808080`)，始终使用 Catppuccin token
- 不嵌套卡片、不包裹一切为卡片
- 不使用 bounce/elastic 缓动函数
- 不使用装饰性渐变、blob/orb、营销风格英雄区
- 不使用 emoji 作为图标（使用 lucide-react）

### 动画约束
参考 `docs/ui-patterns/animation-patterns.md`：
- 动画持续 150-300ms
- 尊重 `prefers-reduced-motion`
- 仅用于有功能意义的状态过渡，不做纯装饰性动画

## 工作流

### 前端任务处理
1. 加载项目 Skill: `docs/skills/mlagent-frontend-product-designer/SKILL.md`
2. 阅读相关代码和设计文档
3. 实现一个可测试的产品可用垂直切片
4. 验证：`npm.cmd run lint` + `npm.cmd run build` (在 `frontend/` 目录)
5. 更新 progress.md / task_plan.md

### 代码标准
- 遵循 TypeScript 严格模式（已在 tsconfig.json 启用）
- 导出函数必须显式标注类型
- 禁止 `any`，使用 `unknown` + 类型收窄
- 使用不可变更新模式
- 错误必须显式处理，不得静默吞掉
- 所有用户输入在边界处验证

### Git
- 当前分支: `feat/p0-backend-hardening`
- 主分支: `master`
- Commit 格式: 遵循已有项目的 convention

## 关键文件索引

| 用途 | 路径 |
|------|------|
| 设计规范 | `design-spec.md` |
| 产品目标 | `docs/final-product-goal.md` |
| 任务计划 | `task_plan.md` |
| 进度记录 | `progress.md` |
| 项目 Skill | `docs/skills/mlagent-frontend-product-designer/SKILL.md` |
| UI 原则 | `docs/skills/mlagent-frontend-product-designer/references/product-ui-principles.md` |
| 设计系统 HTML | `docs/design/design-system.html` |
| 前端样式 | `frontend/src/styles.css` |
| 全局布局 | `frontend/src/app/AppShell.tsx` |
| API 客户端 | `frontend/src/lib/api.ts` |
| 设计反模式 | `docs/design-references/impeccable-antipatterns.md` |
| 品牌参考 | `docs/design-references/linear-design.md`, `cursor-design.md`, `supabase-design.md` |
| 动画模式 | `docs/ui-patterns/animation-patterns.md` |
| shadcn/ui 评估 | `docs/tech-evaluation/shadcn-ui-assessment.md` |
