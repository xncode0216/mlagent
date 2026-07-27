# 动画与微交互模式

> 来源: [DavidHDev/react-bits](https://github.com/DavidHDev/react-bits) — 纯 CSS 变体提取
>
> 本文档提取了 react-bits 中与数据工作台最相关的纯 CSS 动画模式，并适配到 MLAgent 的 Catppuccin 暗色主题 + React 19 + TypeScript 架构。

---

## 通用约束

所有动画必须遵守：

```css
/* 1. 尊重用户动效偏好 */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}

/* 2. 标准缓动函数 */
:root {
  --ease-out: cubic-bezier(0.4, 0, 0.2, 1);
  --ease-in: cubic-bezier(0.4, 0, 1, 1);
  --ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);
  --duration-fast: 150ms;
  --duration-normal: 200ms;
  --duration-slow: 300ms;
}
```

---

## 模式 1: 淡入入场 (Fade In Entrance)

**适用**: 面板展开、对话框打开、通知出现

```css
.fade-enter {
  opacity: 0;
  transform: translateY(4px);
}

.fade-enter-active {
  opacity: 1;
  transform: translateY(0);
  transition:
    opacity var(--duration-normal) var(--ease-out),
    transform var(--duration-normal) var(--ease-out);
}
```

**React 实现**:
```tsx
function FadeIn({ children, show }: { children: React.ReactNode; show: boolean }) {
  return (
    <div
      className={show ? 'fade-enter-active' : 'fade-enter'}
      aria-hidden={!show}
    >
      {children}
    </div>
  );
}
```

---

## 模式 2: 状态过渡指示器 (Loading → Success → Error)

**适用**: 按钮提交、数据加载、操作确认

```css
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  transition:
    background-color var(--duration-normal) var(--ease-out),
    box-shadow var(--duration-normal) var(--ease-out);
}

.status-dot.loading {
  background-color: #6c7086; /* Muted */
  animation: pulse 1.5s ease-in-out infinite;
}

.status-dot.success {
  background-color: #a6e3a1; /* Success */
  box-shadow: 0 0 6px rgba(166, 227, 161, 0.4);
}

.status-dot.error {
  background-color: #fab387; /* Warn */
  box-shadow: 0 0 6px rgba(250, 179, 135, 0.4);
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
```

---

## 模式 3: 悬停微交互 (Hover Micro-interactions)

**适用**: 可操作行、按钮、图标按钮、链接

```css
/* 行悬停高亮 */
.interactive-row {
  transition: background-color var(--duration-fast) var(--ease-out);
}
.interactive-row:hover {
  background-color: rgba(137, 180, 250, 0.06); /* Accent 6% */
}

/* 图标按钮悬停微缩放 */
.icon-button {
  transition:
    transform var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out);
}
.icon-button:hover {
  transform: scale(1.1);
  color: #89b4fa; /* Accent */
}
.icon-button:active {
  transform: scale(0.95);
}

/* 链接下划线滑入 */
.text-link {
  text-decoration: none;
  background-image: linear-gradient(#89b4fa, #89b4fa);
  background-size: 0% 1px;
  background-position: 0% 100%;
  background-repeat: no-repeat;
  transition: background-size var(--duration-normal) var(--ease-out);
}
.text-link:hover {
  background-size: 100% 1px;
}
```

---

## 模式 4: 面板展开/折叠 (Expand/Collapse)

**适用**: 侧栏折叠、手风琴面板、详情展开

```css
.collapsible-panel {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows var(--duration-slow) var(--ease-out);
  overflow: hidden;
}

.collapsible-panel.expanded {
  grid-template-rows: 1fr;
}

.collapsible-panel > .content {
  min-height: 0;
}
```

**React 实现**:
```tsx
function Collapsible({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <div className={`collapsible-panel${open ? ' expanded' : ''}`}>
      <div className="content">{children}</div>
    </div>
  );
}
```

**为什么用 grid-template-rows 而不是 max-height**: `grid-template-rows: 0fr → 1fr` 过渡不需要知道内容的精确高度，auto 也能正确动画。

---

## 模式 5: 通知入场/退场 (Toast Notification)

**适用**: 操作反馈、错误提示、成功确认

```css
.toast-container {
  position: fixed;
  top: 60px; /* 顶部导航下方 */
  right: 16px;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
}

.toast {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background: #11111b; /* Surface */
  border: 1px solid #313244; /* Border */
  border-radius: 8px;
  color: #cdd6f4; /* Text */
  font-size: 14px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  pointer-events: auto;

  /* 入场动画 */
  animation: toast-slide-in var(--duration-normal) var(--ease-out);
}

.toast.leaving {
  animation: toast-slide-out var(--duration-fast) var(--ease-in) forwards;
}

@keyframes toast-slide-in {
  from {
    opacity: 0;
    transform: translateX(100%);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

@keyframes toast-slide-out {
  from {
    opacity: 1;
    transform: translateX(0);
  }
  to {
    opacity: 0;
    transform: translateX(100%);
  }
}

/* 类型变体 */
.toast.error {
  border-color: #fab387; /* Warn */
}
.toast.success {
  border-color: #a6e3a1; /* Success */
}
```

---

## 模式 6: 骨架屏加载 (Skeleton Loading)

**适用**: 面板首次加载、列表数据等待中

```css
.skeleton {
  background: linear-gradient(
    90deg,
    #1e1e2e 25%,   /* Overlay */
    #313244 50%,   /* Border */
    #1e1e2e 75%    /* Overlay */
  );
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.5s ease-in-out infinite;
  border-radius: 4px;
}

@keyframes skeleton-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* 大小变体 */
.skeleton-text { height: 14px; width: 100%; }
.skeleton-title { height: 18px; width: 60%; }
.skeleton-avatar { height: 28px; width: 28px; border-radius: 50%; }
.skeleton-button { height: 32px; width: 80px; border-radius: 6px; }
```

---

## 模式 7: 焦点环 (Focus Ring)

**适用**: 所有可交互元素的可访问键盘导航

```css
/* 替换浏览器默认 outline */
:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px #0a0a0f, 0 0 0 4px #89b4fa;
  /*          外圈 Base 底，内圈 Accent 蓝 */
}

/* 对暗色面板内元素 */
.panel :focus-visible {
  box-shadow: 0 0 0 2px #11111b, 0 0 0 4px #89b4fa;
}
```

---

## 模式 8: 数字跳动 (Count Up)

**适用**: 统计数据更新、指标变化、训练进度

```css
.count-up {
  display: inline-block;
  font-variant-numeric: tabular-nums; /* 数字等宽，防止跳动 */
}
```

```tsx
function CountUp({ value, duration = 300 }: { value: number; duration?: number }) {
  const [display, setDisplay] = React.useState(value);
  const prevRef = React.useRef(value);

  React.useEffect(() => {
    if (value === prevRef.current) return;
    const start = prevRef.current;
    const diff = value - start;
    const startTime = performance.now();

    function tick(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(start + diff * eased);
      if (progress < 1) requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
    prevRef.current = value;
  }, [value, duration]);

  return <span className="count-up">{Math.round(display).toLocaleString()}</span>;
}
```

---

## 使用原则

1. **功能意义优先**: 只在状态转换、反馈确认、焦点引导时使用动画
2. **时长控制在 150-300ms**: 再短不可感知，再长拖沓
3. **一致性**: 同一类操作使用相同的缓动和时长
4. **性能**: 只动画 `opacity` 和 `transform`（GPU 加速属性），避免动画 `width`/`height`
5. **可访问性**: 始终提供 `prefers-reduced-motion` 回退

## 不可使用

- ❌ 不使用 bounce/elastic ease（线性之外的任何"弹跳"效果）
- ❌ 不使用 animation-delay 创建 stagger 效果（会导致 LCP 延迟）
- ❌ 不使用无限循环的装饰性动画
- ❌ 不在 `:hover` 时启动关键帧动画（仅用 transition）
