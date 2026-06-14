import { vi } from "vitest";

/**
 * jsdom 不实现 WebSocket，而 `useAgentStream` 在组件挂载时会无条件
 * `new WebSocket(...)`。这个最小桩提供构造函数、静态 OPEN 常量与
 * send/close 等接口，让组件能正常挂载而不真正发起网络连接。
 */
export class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  url: string;
  readyState: number = FakeWebSocket.CONNECTING;
  onopen: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessage: ((event: unknown) => void) | null = null;

  constructor(url: string) {
    this.url = url;
  }

  send(): void {
    // 桩：丢弃出站消息。
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.(undefined);
  }
}

/** 把全局 WebSocket 替换为 FakeWebSocket，供需要挂载真实组件的测试调用。 */
export function installWebSocketStub(): void {
  vi.stubGlobal("WebSocket", FakeWebSocket);
}
