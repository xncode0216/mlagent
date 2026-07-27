# Supabase 品牌 DESIGN.md

> 来源: [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) — Supabase 营销站点设计系统
>
> **适配说明**: Supabase 是开发者平台，其数据仪表板、SQL 编辑器、查询构建器等 UI 模式与 MLAgent 的数据分析面板高度相关。以下提取关键设计原则，并标注与 MLAgent 的映射关系。

---

## 设计哲学

- **"清晰度高于一切"** — 白色画布营销轨道 + 近单色色板
- **单一色彩事件**: 仅一个翡翠绿作为"页面上唯一的彩色事件"
- **"安静技术感"**: 完全依赖白色背景，不使用氛围渐变、摄影图或深色画布营销区
- **产品 UI 截图即装饰**: 仪表板表、SQL 编辑器、查询构建器、日志流作为装饰素材而非插图

## MLAgent 可借鉴原则

| Supabase 原则 | MLAgent 应用 |
|---------------|-------------|
| 单一强调色策略 | Accent blue `#89b4fa` 严格用于主交互元素 |
| 产品截图作为说服力 | MLAgent 工作台本身就是最好的展示 |
| 代码块始终深色底 | 已在 Catppuccin 中使用深色 Surface |
| 按钮方形化（6px圆角） | 可借鉴，与 Catppuccin 6-8px 圆角一致 |
| 显示文字 weight 500 为上限 | 保持专业/工程感 |

---

## 色彩系统（浅色）

### 品牌色
| Token | Hex | 角色 |
|-------|-----|------|
| primary | `#3ecf8e` | 签名 CTA 填充、wordmark 强调色 |
| primary-deep | `#24b47e` | 按下态 |

关键特征: Supabase 在翡翠绿按钮上使用深色(`#171717`)文字而非白色——让按钮看起来像"被点亮的表面"，不是彩色药丸。

### 表面色
| Token | Hex | 角色 |
|-------|-----|------|
| canvas | `#ffffff` | 默认页面底 |
| canvas-soft | `#fafafa` | 微着色偏白分区 |
| canvas-night | `#1c1c1c` | 代码块、仪表板模拟图、特色价格卡 |
| canvas-night-soft | `#202020` | 嵌套深色 chrome |

### 文字色
| Token | Hex | 角色 |
|-------|-----|------|
| ink | `#171717` | 默认正文（近黑，永不全黑）|
| ink-mute | `#707070` | 次要/辅助文字 |
| ink-faint | `#b2b2b2` | 禁用/占位 |
| on-dark | `#ffffff` | 深色面上的文字 |

### 映射到 MLAgent Catppuccin 暗色
| Supabase 原则 | MLAgent Token | Hex |
|---------------|---------------|-----|
| 主表面 | Base | `#0a0a0f` |
| 面板/卡片 | Surface | `#11111b` |
| 代码块深底 | Overlay | `#1e1e2e` |
| 主文本 | Text | `#cdd6f4` |
| 辅助文字 | Subtext | `#a6adc8` |
| 弱化文字 | Muted | `#6c7086` |
| 强调色 | Accent | `#89b4fa` |

---

## 排版

**主字体**: Circular (proprietary) → 开源替代: **Inter weight 500** 或 Geist Sans
**代码字体**: `ui-monospace, Menlo, Monaco, Consolas, monospace`

| Token | Size | Weight | Line Height | Letter Spacing | 用途 |
|-------|------|--------|-------------|----------------|------|
| display-xxl | 64px | 500 | 1.1 | -1.92px | Hero 标题 |
| display-xl | 48px | 500 | 1.1 | -1.44px | 段落开场 |
| display-lg | 36px | 500 | 1.15 | -0.72px | 子段落/价格 |
| heading-lg | 22px | 500 | 1.2 | 0 | 紧凑标题 |
| body-md | 16px | 400 | 1.5 | 0 | 默认 UI 正文 |
| button-md | 14px | 500 | 1.0 | 0 | 按钮标签 |
| code | 14px | 400 | 1.5 | 0 | 代码块 |

### 核心原则
- 所有展示层使用 weight 500 — "中等字重读起来有工程感，不花哨"
- weight 永远不超过 500，品牌在 600+ 时崩坏
- 展示字号带负 tracking 以收紧圆润人文主义字体的编辑密度

---

## 间距体系（8px 基准）

| Token | Value | 用途 |
|-------|-------|------|
| xxs | 2px | |
| xs | 4px | |
| sm | 8px | |
| md | 12px | |
| lg | 16px | 默认内边距 |
| xl | 24px | |
| xxl | 32px | 卡片内部 padding |
| huge | 64px | 段落间距 (64-96px) |

容器最大宽度: ~1280px 居中，无边距出血。

---

## 圆角

| Token | Value | 适用 |
|-------|-------|------|
| xs | 4px | 表单输入、细线标签 |
| sm | 6px | **按钮（签名圆角）**、代码块 |
| md | 8px | 紧凑卡片、提示 |
| lg | 12px | 价格/功能卡片、产品模型图 |
| xl | 16px | 模态框 |
| full | 9999px | 药丸标签、头像 |

按钮圆角 6px — "方正的、技术感的，永不做药丸形"。

---

## 阴影层级

| Level | 值 | 使用 |
|-------|-----|------|
| 0 | 扁平, 1px hairline | 默认卡片 |
| 1 | `0 1px 3px rgba(0,0,0,0.06)` | 微妙卡片抬升 |
| 2 | `0 8px 24px rgba(0,0,0,0.08)` | 浮动合成 UI 模型图 |
| 3 | `0 16px 48px rgba(0,0,0,0.12)` | 模态覆盖层 |

**关键特征**: 产品 UI 截图的合成模型图（含 Level 2 阴影）是"品牌的论证"——这是 Supabase 最独特的视觉资产，MLAgent 同样适用：**工作台本身就是最好的产品展示**。

---

## 组件精要

### 按钮
- 主 CTA: `#3ecf8e` 背景 + `#171717` 深色文字（不是白色！）+ 6px 圆角 + 8×16px padding
- 次级: 白底 + 1px `#c7c7c7` 描边
- **永不做药丸形按钮**（full radius）

### 代码块
- 背景 `#1c1c1c` + 白色文字 + code 字型 + 16px padding + 6px 圆角

### 产品 UI 模型图（最有参考价值）
- 多层仪表板/SQL编辑器/日志面板合成图
- Level 2 阴影
- 放在白色画布上
- 12px 圆角容器
- 无周围装饰

---

## 响应式

| 断点 | 宽度 | 行为 |
|------|------|------|
| Wide | ≥1440px | 全尺寸 |
| Desktop | 1024-1440px | 默认 4 列 |
| Tablet | 768-1023px | 2 列，模型图单面板 |
| Mobile | <768px | 单列，汉堡菜单 |

触控目标 ≥36×36px 最低。

---

## 禁止项（Supabase 绝对约束）

- ❌ 不引入第二个系统颜色（翡翠绿之外）
- ❌ 展示字重不超过 500
- ❌ 不使用药丸形按钮（full radius 仅用于标签/头像）
- ❌ 翡翠绿按钮上不使用白色文字（用深色文字）
- ❌ 不在 Hero 区添加氛围渐变 — "白色画布就是设计"

## MLAgent 对应的绝对约束

- ❌ 不引入第二个强调色（只在 accent/machine-learning/success/warn 四个既有 token 中选用）
- ❌ 按钮圆角保持在 6-8px，不做药丸形
- ❌ 数据/分析面板使用紧凑信息密度，不做大留白
- ❌ 不使用装饰性渐变
