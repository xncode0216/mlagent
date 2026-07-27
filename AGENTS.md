# MLAgent Agent Rules

## 项目设计约束（必须遵守）

- **纯 CSS 架构**: 不引入 Tailwind CSS、shadcn/ui、MUI、Ant Design 或任何第三方 UI 组件库
- **Catppuccin 暗色主题**: 所有颜色来自既定 token 体系
- **lucide-react**: 唯一图标来源
- **Inter + JetBrains Mono**: 锁定字体体系
- 详细约束见 `CLAUDE.md` 和 `docs/design-references/impeccable-antipatterns.md`

## Frontend Optimization Agent

For any task that designs, reviews, implements, or polishes the frontend UI/UX, first use the project skill at:

```text
docs/skills/mlagent-frontend-product-designer/SKILL.md
```

Treat this as the dedicated MLAgent frontend product design agent. It owns product-grade UI decisions for navigation, panels, data/ML workflows, knowledge graph interactions, settings, accessibility, responsive behavior, and visual polish.

Expected workflow:

1. Load `mlagent-frontend-product-designer` (includes design reference index).
2. Read the relevant product plan/progress docs and affected React/CSS/API files.
3. Consult relevant design references when needed:
   - `docs/design-references/impeccable-antipatterns.md` — 避免 AI-slop
   - `docs/design-references/linear-design.md` — 紧凑操作 UI 参考
   - `docs/design-references/cursor-design.md` — IDE 编辑器风格参考
   - `docs/design-references/supabase-design.md` — 数据面板参考
   - `docs/ui-patterns/animation-patterns.md` — 动效模式参考
4. Implement one testable, product-usable vertical slice.
5. Verify with frontend lint/tests/build and browser QA when visible UI changes.
6. Update project progress/planning docs when behavior or priorities change.

