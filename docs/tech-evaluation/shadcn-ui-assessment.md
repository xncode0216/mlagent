# shadcn/ui 技术评估

> 评估日期: 2026-06-15
> 评估对象: [shadcn/ui](https://github.com/shadcn-ui/ui) (117K+ stars, MIT)

---

## 项目概述

shadcn/ui 是一套设计精美、可访问的 React 组件集合。它不是一个传统的 npm 组件库 — 组件通过 CLI 直接复制源代码到项目，开发者拥有完全的定制和修改权。

---

## 核心依赖

| 依赖 | 说明 |
|------|------|
| React 18+ | 核心框架 |
| **Tailwind CSS** | **强制依赖 — 所有样式基于 Tailwind** |
| Radix UI | 底层无样式可访问组件 |
| Lucide React | 图标库 |
| TanStack Table | 表格组件 |

---

## MLAgent 当前项目评估

### 不适合的原因

| 因素 | 详情 |
|------|------|
| **架构冲突** | MLAgent 使用纯 CSS (3349行 `styles.css`, Catppuccin 暗色主题)，无 Tailwind 依赖 |
| **迁移成本** | 引入 Tailwind 意味着重写全部 3349 行 CSS，将所有 Catppuccin token 映射为 Tailwind 配置 |
| **设计系统冲突** | shadcn/ui 的设计 token 体系与 Catppuccin 差异大，需要大量覆盖 |
| **违背项目约束** | AGENTS.md 和项目 Skill 明确禁止引入新的 UI 框架 |
| **打包体积** | 引入 Tailwind + Radix + shadcn 组件会显著增加依赖量 |

### 结论

**❌ 不适用于 MLAgent 当前项目。**

---

## 适用场景

shadcn/ui 在以下场景中是**首选方案**：

1. **启动新的 Tailwind 项目**: 如果从零开始构建 React 应用且选择 Tailwind 作为样式方案
2. **SaaS 产品 MVP**: 快速搭建高质量的仪表板、管理后台
3. **需要完整组件生态**: 表单、表格、对话框、Sheet、Command 面板等开箱即用
4. **追求开发速度 > 极致定制**: 复制即用的组件开发体验

---

## 与 MLAgent 兼容的条件

如果满足以下条件，shadcn/ui 可以用于 MLAgent：

1. **技术栈变更**: 项目决定从纯 CSS 迁移到 Tailwind CSS
2. **设计系统适配**: 创建完整的 Catppuccin → Tailwind token 映射配置
3. **渐进式迁移**: 新组件使用 shadcn/ui + Tailwind，旧组件逐步迁移

**预计工作量**: 2-3 周（包含 Tailwind 配置、token 映射、组件替换、测试验证）

---

## 组件清单（参考）

shadcn/ui 提供的组件（v4.x）包括但不限于：

- **布局**: Accordion, Card, Dialog, Drawer, Sheet, Popover
- **导航**: Breadcrumb, Navigation Menu, Pagination, Sidebar, Tabs
- **表单**: Button, Checkbox, Combobox, Date Picker, Form, Input, Select, Textarea, Toggle
- **数据**: Table, Data Table, Chart
- **反馈**: Alert, Progress, Skeleton, Sonner (Toast), Tooltip
- **高级**: Command (⌘K 面板), Context Menu, Dropdown Menu, Hover Card

---

## 替代方案对照

由于 MLAgent 不使用 shadcn/ui，当前项目的等价方案：

| shadcn/ui 组件 | MLAgent 当前实现 |
|----------------|-----------------|
| Button | 纯 CSS `.btn` 类 |
| Dialog | 纯 CSS `.modal` / `.overlay` |
| Tabs | 纯 CSS `.tabs` 实现（已存在） |
| Table | 纯 CSS `table` 样式 |
| Input | 纯 CSS `input` 样式 |
| Card | 纯 CSS `.panel` / `.card` 类 |
| Toast | Zustand + 纯 CSS（可参考 animation-patterns.md） |
| Command | 尚无，可从 Linear DESIGN.md 借鉴命令面板模式 |

---

## 未来建议

如果 MLAgent 后续推出以下产品形态，shadcn/ui 值得重新评估：

1. **管理后台 / Admin Panel** — shadcn/ui 对此类场景支持最佳
2. **独立的仪表板产品** — Data Table、Chart 组件可直接使用
3. **面向外部用户的 SaaS 界面** — 快速搭建注册/登录/设置/计费页面

**建议**: 在不引入 Tailwind 的前提下，可以从 shadcn/ui 的源码中借鉴以下内容：
- 组件的行为逻辑（状态机、事件处理）
- 无障碍实现模式（ARIA 属性、键盘导航）
- 组件的 props API 设计
- 这些借鉴不会破坏纯 CSS 架构，同时提升代码质量
