# Cursor 品牌 DESIGN.md

> 来源: [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) — Cursor 营销站点设计系统
>
> **适配说明**: Cursor 是 AI IDE，与 MLAgent 产品形态高度重合。以下提取了 Cursor 的设计哲学和关键 token，并标注了与 MLAgent Catppuccin 暗色主题的映射关系。

---

## 设计哲学

- **"编辑式冷静而非 IDE 黑暗"** — Cursor 刻意避免传统 IDE 的纯黑背景，选择暖色调的奶油白
- **"安静自信"**的品牌声音
- **单一强调色策略**: 仅一个品牌色（Cursor Orange `#f54e00`），仅用于主 CTA 和 wordmark
- **无阴影**: 卡片分离仅靠 1px 细线 + 白底与奶油底之间的亮度差异
- **展示字重永不加粗**: 一致用 weight 400，形成"杂志编辑声音而非科技喧哗"

## MLAgent 可借鉴原则

| Cursor 原则 | MLAgent 应用 |
|-------------|-------------|
| 单一强调色，极少使用 | Accent blue `#89b4fa` 仅用于主交互元素 |
| 代码字体单独层级 | JetBrains Mono 13px 已是规范 |
| 细线分割代替阴影 | 已在 Catppuccin 中使用 `#313244` border |
| 展示文字不走 bold | 适用 — 保持工作台的冷静专业感 |
| Timeline 彩色小药丸 | 可借鉴用于工作流阶段指示器 |

---

## 色彩参考

### 暖色调浅色系统（Cursor 原始）

| Token | Hex | 用途 |
|-------|-----|------|
| canvas | `#f7f7f4` | 页面底色 |
| surface-card | `#ffffff` | 卡片白底 |
| hairline | `#e6e5e0` | 1px 分割线 |
| ink | `#26251e` | 正文（暖近黑） |
| body | `#5a5852` | 默认正文 |
| muted | `#807d72` | 辅助文字 |
| primary | `#f54e00` | CTA 按钮 |

### 映射到 Catppuccin 暗色（MLAgent 当前）
Cursor 是浅色系统，MLAgent 是暗色系统，但设计原则可直接平移：

| Cursor 原则 | MLAgent Catppuccin Token | Hex |
|-------------|-------------------------|-----|
| 页面底色 | Base | `#0a0a0f` |
| 卡片/面板 | Surface | `#11111b` |
| 悬浮层 | Overlay | `#1e1e2e` |
| 分割线 | Border | `#313244` |
| 主文本 | Text | `#cdd6f4` |
| 次要文本 | Subtext | `#a6adc8` |
| 弱化文本 | Muted | `#6c7086` |
| 主交互色 | Accent (blue) | `#89b4fa` |

### Cursor Timeline 彩色阶段指示器（可借鉴）
Cursor 的 Agent 时间线使用 5 色药丸标记不同阶段：

| 阶段 | Hex | 描述 |
|------|-----|------|
| Thinking | `#dfa88f` | Peach |
| Grepping | `#9fc9a2` | Mint |
| Reading | `#9fbbe0` | Pastel blue |
| Editing | `#c0a8dd` | Lavender |
| Done | `#c08532` | Warm gold |

MLAgent 可借鉴此模式用于工作流阶段指示器（已有 workflow stages）。

---

## 排版

| Token | Size | Weight | Line Height | 用途 |
|-------|------|--------|-------------|------|
| display-mega | 72px | 400 | 1.1 | Hero h1 |
| display-lg | 36px | 400 | 1.2 | 段落标题 |
| display-md | 26px | 400 | 1.25 | 子段标题 |
| title-md | 18px | 600 | 1.4 | 组件标题 |
| body-md | 16px | 400 | 1.5 | 默认正文 |
| caption | 13px | 400 | 1.4 | 说明文字 |
| code | 13px | 400 | 1.5 | 代码 (JetBrains Mono) |
| button | 14px | 500 | 1.0 | 按钮 |

### 核心排版原则
- 展示字重始终 400，永不加粗 — "杂志声音"
- 展示字号带负 letter-spacing（-0.11px ~ -2.16px）
- 代码始终 JetBrains Mono 13px

---

## 间距体系（4px 基准）

| Token | Value | 用途 |
|-------|-------|------|
| xxs | 4px | |
| xs | 8px | |
| sm | 12px | |
| base | 16px | 默认内边距 |
| md | 20px | |
| lg | 24px | |
| xl | 32px | 卡片内边距 |
| xxl | 48px | |
| section | 80px | 段落间距 |

---

## 圆角体系

| Token | Value | 适用 |
|-------|-------|------|
| none | 0px | |
| xs | 4px | 内联标签 |
| sm | 6px | 紧凑行 |
| md | 8px | CTA 按钮、输入框 |
| lg | 12px | 卡片、IDE 面板 |
| pill | 9999px | 时间线药丸、头像 |

---

## 组件规范精要

### 按钮
- 主 CTA: 背景色即品牌色 + 白色文字，14px/500，8px 圆角，10×18px padding
- 次级: 白底 + 1px border + ink 文字
- 下载 CTA 特殊处理: ink 背景 + canvas 文字 → 在 MLAgent 中可能为 accent 背景 + base 文字

### 卡片
- 白底 + 1px hairline 描边 + 12px 圆角 + 24px padding
- 无任何阴影
- 价格卡片 feature 版: 反转（ink 背景 + canvas 文字）

### IDE Mockup 卡片（最有参考价值）
- 白底表面卡片、12px 圆角、1px 细线边框
- 零内部 padding — 内部面板填充到边缘
- 内含多面板布局: 侧栏、主编辑器、聊天面板、终端
- 每个独立面板用 `canvas-soft` 背景 + JetBrains Mono 13px + 8px 圆角 + 16px padding

### 代码块
- 白底表面卡片 + JetBrains Mono 13px + 12px 圆角 + 20px padding + 1px 细线边框

---

## 响应式

| 断点 | 宽度 | 行为 |
|------|------|------|
| Mobile | <640px | Hero h1 ~32px, 单栏 |
| Tablet | 640-1024px | 2 列网格 |
| Desktop | 1024-1280px | 默认 3 列, 全尺寸 |
| Wide | >1280px | 内容上限 1200px |

触控目标: 主 CTA 40px，下载 CTA 44px。

---

## 禁止项（Cursor 绝对约束）

- ❌ 不引入第二个品牌色
- ❌ 展示文字不超过 weight 400
- ❌ 不添加 drop-shadow
- ❌ 时间线 pastel 色仅用于 Agent 阶段指示，不得外泄
- ❌ 不在页面底色上使用纯白

## MLAgent 对应的绝对约束

- ❌ 不引入第二个强调色
- ❌ 不引入 Tailwind / shadcn/ui / 第三方 UI 库
- ❌ 不使用装饰性渐变
- ❌ 不嵌套卡片
- ❌ 不使用 bounce/elastic 缓动
