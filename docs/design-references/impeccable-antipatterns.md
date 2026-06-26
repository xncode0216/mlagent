# Impeccable 设计反模式规则

> 来源: [pbakaus/impeccable](https://github.com/pbakaus/impeccable) — "让 AI 编码助手产出更好设计的设计语言"
> 本文档提取自 impeccable 项目的反模式规则，并针对 MLAgent 的 Catppuccin 暗色主题 + 纯 CSS + React 架构进行了适配。

---

## 一、字体反模式

### ❌ 禁止: 使用 AI 默认字体
AI 生成 UI 时最常滥用的字体：**Inter、Arial、Roboto、system-ui**（在没有明确设计决策的情况下）。

**MLAgent 规则**: 项目已确定字体体系，不得随意更改：
- UI 文本: Inter（system-ui 回退）
- 代码: JetBrains Mono（monospace 回退）
- 任何新 UI 组件必须遵循此字体体系

### ❌ 禁止: 字重滥用
- 不得在正文中使用 bold（700+）字重
- 标题字重不超过 600
- 代码始终使用 400 字重

---

## 二、色彩反模式

### ❌ 禁止: 纯黑色和纯灰色
```css
/* ❌ 错误 */
color: #000000;
color: #808080;
background: #000;
background: #333;

/* ✅ 正确 — 使用 Catppuccin token */
color: #cdd6f4;   /* Text */
color: #a6adc8;   /* Subtext */
color: #6c7086;   /* Muted */
background: #0a0a0f;  /* Base */
background: #11111b;  /* Surface */
background: #1e1e2e;  /* Overlay */
```

### ❌ 禁止: 灰色文字在彩色背景上
这是 AI 生成 UI 的标志性特征——在彩色背景上用灰色文字。

```css
/* ❌ 错误 */
background: #e3f2fd;
color: #666666;

/* ✅ 正确 — 彩色背景上用深色文字或同色系更暗色 */
background: rgba(137, 180, 250, 0.15);  /* Accent 15% */
color: #89b4fa;  /* Accent 原色 */
```

### ❌ 禁止: 无色调变化的单色界面
AI 倾向于生成"全是蓝色"或"全是紫色"的界面。必须有中性结构色的支撑。

**MLAgent 规则**: 主色（accent）仅用于交互元素（按钮、链接、选中态），结构和文本使用中性 Catppuccin token。

---

## 三、布局反模式

### ❌ 禁止: 嵌套卡片
```html
<!-- ❌ 错误 — 卡片中的卡片中的卡片 -->
<div class="card">
  <div class="card">
    <div class="card">...</div>
  </div>
</div>

<!-- ✅ 正确 — 仅一层容器，内部分区用分割线或间距 -->
<div class="card">
  <div class="section">...</div>
  <hr class="divider" />
  <div class="section">...</div>
</div>
```

### ❌ 禁止: 一切皆为卡片
不是每个内容块都需要卡片包裹。列表、表格、文本块在平面上直接展示往往更好。

### ❌ 禁止: 过度留白（AI-Slop 标志）
AI 生成 UI 常见特征：巨大 padding、空旷的 Hero 区、松散的信息密度。

**MLAgent 规则**（来自项目 Skill）:
> "Favor compact, scannable operational UI over hero blocks, nested cards, or decorative panels."
> 首个视口必须是可用的工作台面，不是着陆页。

---

## 四、动效反模式

### ❌ 禁止: Bounce / Elastic 缓动
```css
/* ❌ 错误 */
transition: all 0.5s cubic-bezier(0.68, -0.55, 0.27, 1.55); /* bounce */
transition: all 0.5s cubic-bezier(0.25, 0.1, 0.25, 1.2);   /* elastic */

/* ✅ 正确 — 标准缓动 */
transition: opacity 0.2s ease;
transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
```

### ❌ 禁止: 无意义的装饰性动画
动画必须有功能意义：状态过渡、反馈确认、焦点引导。不做"因为能动所以动"的动画。

### ❌ 禁止: 不尊重 prefers-reduced-motion
```css
/* ✅ 必须包含 */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## 五、图标反模式

### ❌ 禁止: Emoji 作为 UI 图标
emoji 在不同操作系统中渲染不一致，破坏专业感。

**MLAgent 规则**: 项目已锁定 lucide-react 作为唯一图标来源。不得使用 emoji 作为功能图标。

### ❌ 禁止: 图标缺乏语义标签
```tsx
// ❌ 错误
<span className="icon">🔍</span>

// ✅ 正确
<Search size={16} aria-label="搜索" />
```

---

## 六、间距反模式

### ❌ 禁止: 不一致的间距
AI 常见问题：同一页面中 padding 在 8px/12px/16px/20px/24px 之间随机跳变。

**MLAgent 规则**: 使用 4px 基准间距体系（4, 8, 12, 16, 20, 24, 32, 48），同一组件内保持一致。

### ❌ 禁止: 触碰目标过小
所有可点击元素至少 44×44px（符合 WCAG 2.5.5）。

---

## 七、内容反模式

### ❌ 禁止: AI 生成的 Lorem Ipsum 占位文案
永远不要在产品代码中使用 "Lorem ipsum dolor sit amet" 或 AI 编造的假人名/假公司名。使用实际可能出现的真实内容或明确的占位标记 `[待补充]`。

### ❌ 禁止: 模糊的空状态
空状态必须给用户明确的下一步行动指引，不能只是一句 "No data"。

---

## 八、可访问性反模式

### ❌ 禁止: 依赖颜色传达唯一信息
选中态、错误态、成功态必须有非颜色的视觉区分（图标、文字、形状）。

### ❌ 禁止: 对比度不足
- 正文文本最低 4.5:1（AA 标准）
- 大文本（18px+）最低 3:1

### ❌ 禁止: 无焦点样式
所有可交互元素必须有可见的 `:focus-visible` 样式。不能依赖浏览器默认的 focus outline（各浏览器不一致）。

---

## 检查清单

在提交任何前端代码前确认：

- [ ] 没有使用纯黑(`#000`)或纯灰(`#808080`)
- [ ] 颜色来自 Catppuccin token 体系
- [ ] 没有嵌套卡片
- [ ] 没有装饰性渐变或 blob/orb
- [ ] 没有 bounce/elastic 缓动
- [ ] 包含 `prefers-reduced-motion` 回退
- [ ] 图标来自 lucide-react
- [ ] 没有 emoji 作为功能图标
- [ ] 可点击元素 ≥ 44×44px
- [ ] 有可见的 `:focus-visible` 样式
- [ ] 错误/选中/禁用态不使用颜色作为唯一区分方式
- [ ] 没有 Lorem Ipsum 占位文案
