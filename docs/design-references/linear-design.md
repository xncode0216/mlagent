# Linear 品牌 DESIGN.md

> 来源: [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) — Linear 设计系统
>
> **重要**: Linear 的原始 DESIGN.md 文件在仓库中路径可能已变更。本文档基于 Linear 公开设计语言重构，适用于 MLAgent 的 IDE/工作台产品形态。
>
> **适配说明**: Linear 是项目管理工具，其"超简约、精确、紫色强调色"的设计语言与 MLAgent 的 IDE 数据工作台高度兼容。两者都追求操作密度和键盘效率。

---

## 设计哲学

- **"超简约、精确、紫色强调色"** — 专为工程工具打造
- **暗色默认**: Linear 以暗色模式为主要界面，与 MLAgent 的 Catppuccin 暗色主题天然一致
- **键盘驱动**: 所有操作可通过命令面板（⌘K）触达，UI 服务于快捷键工作流
- **极简视觉**: 去除一切非必要装饰，信息层级通过字体大小、字重、间距表达
- **操作密度**: 紧凑的列表视图、压缩的间距、可扫描的 Issue 行

## MLAgent 直接应用

Linear 的设计原则与 MLAgent 的项目 Skill 要求高度一致：

| Linear 原则 | MLAgent 项目 Skill 对应 |
|-------------|------------------------|
| 紧凑可扫描的操作 UI | "Favor compact, scannable operational UI" |
| 去除装饰 | "Avoid one-note palettes, decorative blobs/orbs" |
| 键盘驱动工作流 | "Preserve keyboard reachability" |
| 暗色默认 | Catppuccin 暗色主题 |
| 命令面板 | 可借鉴用于 Agent 操作入口 |

---

## 色彩参考

### Linear 暗色主题
| Token | Hex | 用途 |
|-------|-----|------|
| 主背景 | `#0d0d0d` | 最深底 |
| 侧栏背景 | `#121212` | 次要表面 |
| 卡片/面板 | `#1a1a1a` | 悬浮表面 |
| 分割线 | `#2a2a2a` | 细线分割 |
| 主文本 | `#e6e6e6` | 高优先级文字 |
| 次要文本 | `#999999` | 辅助信息 |
| 弱化文本 | `#666666` | 元数据/时间戳 |
| Accent (紫) | `#5E6AD2` | 主交互色、选中态 |
| Accent hover | `#6C77E0` | 悬停态 |
| Success | `#4CB944` | 完成/已解决 |
| Warning | `#F2C94C` | 待处理/警告 |
| Error | `#E5484D` | 阻塞/错误 |

### 映射到 MLAgent Catppuccin

| Linear Token | MLAgent Catppuccin | Hex |
|-------------|-------------------|-----|
| 主背景 | Base | `#0a0a0f` |
| 面板背景 | Surface | `#11111b` |
| 悬浮表面 | Overlay | `#1e1e2e` |
| 分割线 | Border | `#313244` |
| 主文本 | Text | `#cdd6f4` |
| 次要文本 | Subtext | `#a6adc8` |
| 弱化文本 | Muted | `#6c7086` |
| 强调色 | Accent (blue) | `#89b4fa` |
| 成功 | Success (green) | `#a6e3a1` |
| 警告 | Warn (orange) | `#fab387` |
| 错误 | 使用 Warn 或自定义 | `#fab387` |

---

## 排版

Linear 使用 **Inter** 作为 UI 字体，**JetBrains Mono** 作为代码字体（与 MLAgent 完全一致！）。

| 层级 | Size | Weight | 用途 |
|------|------|--------|------|
| 页面标题 | 24px | 600 | 视图标题 |
| 面板标题 | 16px | 600 | 侧栏/面板标题 |
| 列表项标题 | 14px | 500 | Issue 行标题 |
| 正文 | 14px | 400 | 描述、评论 |
| 元数据 | 12px | 400 | 时间戳、ID、标签 |
| 代码 | 13px | 400 | 内联代码、代码块 |
| 快捷键 | 11px | 500 | ⌘K 提示 |

### 核心原则
- 仅两级字重: 400 (正文) 和 500-600 (标题)
- 默认字号 14px（比常见的 16px 更紧凑）
- 列表行高度约 36-40px（紧凑扫描密度）
- 全局 letter-spacing: -0.01em（微收紧）

---

## 间距体系（4px 基准）

Linear 使用极其紧凑的间距：

| Token | Value | 用途 |
|-------|-------|------|
| 2xs | 2px | 紧密关联元素 |
| xs | 4px | 图标与文字间距 |
| sm | 8px | 列表项内部 |
| md | 12px | 面板内边距 |
| lg | 16px | 卡片内边距 |
| xl | 24px | 段落间距 |
| 2xl | 32px | 大区块间距 |

**关键**: 默认内容区内边距 12-16px（不是 Bootstrap 式的 24-32px）。这对于操作密集工作台至关重要。

---

## 圆角体系

| Token | Value | 适用 |
|-------|-------|------|
| xs | 3px | 内联代码、标签 |
| sm | 6px | 按钮、输入框 |
| md | 8px | 卡片、面板 |
| lg | 12px | 模态框 |
| full | 9999px | 头像（极少使用） |

---

## 组件设计精髓

### Issue 列表行（Linear 的签名 UI → MLAgent 的工作流步骤行）
```
┌──────────────────────────────────────────────────┐
│ [✓] BUG-123  Fix memory leak in kernel pool   #bug │
│     12px  14px/500                 11px pill      │
│     40px 行高                                     │
└──────────────────────────────────────────────────┘
```
- 每行可快速扫描: checkbox + ID + 标题 + 标签
- 行高紧凑（~40px），hover 时背景微亮
- 标签用小号药丸（12px/500），颜色极克制

### 命令面板（⌘K）
- 居中的模态覆盖层
- 搜索框 + 即时结果列表
- 每项左对齐的图标 + 名称 + 右侧快捷键提示
- 暗色半透明背景遮罩

### 侧栏导航
- 可折叠分组
- 每项: 图标 + 文本 + 可选计数 badge
- 活跃项用 accent 色左侧竖线或背景标记
- 紧凑间距，约 32px 每项

---

## 交互模式

### 悬停可见操作
Linear 的标志性模式：操作按钮默认隐藏，hover 行时浮现。减少视觉噪音，保持操作可达。

```css
/* 默认隐藏 */
.row-actions { opacity: 0; }
/* hover 时显示 */
.row:hover .row-actions { opacity: 1; }
```

### 内联编辑
双击文本直接进入编辑模式，就地修改，无需弹窗。这与 MLAgent 的"直接操作"原则一致。

### 键盘优先
- 所有列表支持 ↑↓ 导航
- Enter 打开/确认
- Escape 关闭/取消
- ⌘K 唤起命令面板
- 空格切换 checkbox

---

## 禁止项

- ❌ 不使用超过两个层级的嵌套容器
- ❌ 卡片不需阴影（暗色界面中用 1px border 或背景亮度差即可区分）
- ❌ 不使用装饰性图标 — 每个图标必须传达功能信息
- ❌ 不滥用颜色 — 一行中最多用 1-2 个彩色标签
- ❌ 正文不使用 bold（用 font-weight 600 仅用于标题）

## MLAgent 特别适用场景

Linear 的设计模式最适用于 MLAgent 的以下界面:
1. **文件浏览器** — 紧凑文件列表行，悬停显示操作按钮
2. **会话列表** — 可扫描的历史会话行
3. **工作流步骤** — 与 Linear Issue 行高度相似的阶段进度行
4. **命令面板** — ⌘K 全局操作入口
5. **Artifact 面板** — 紧凑卡片 + 元数据行
