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

  /** 已创建的实例，供测试断言是否连接、连到哪个会话。 */
  static instances: FakeWebSocket[] = [];

  url: string;
  readyState: number = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessage: ((event: unknown) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(payload: string): void {
    this.sent.push(payload);
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.(undefined);
  }
}

/** 把全局 WebSocket 替换为 FakeWebSocket，供需要挂载真实组件的测试调用。 */
export function installWebSocketStub(): void {
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
}
