// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeWebSocket, installWebSocketStub } from "../../test/websocketStub";
import { useAgentStream } from "./useAgentStream";

beforeEach(() => {
  installWebSocketStub();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function openLatestSocket() {
  const socket = FakeWebSocket.instances.at(-1);
  if (!socket) throw new Error("no socket was created");
  act(() => {
    socket.readyState = FakeWebSocket.OPEN;
    socket.onopen?.(undefined);
  });
  return socket;
}

describe("agent stream session readiness", () => {
  // 会话就绪前若连到占位会话，消息会真的发出去并被后端执行，
  // 但会话切换时事件流被清空，响应就此丢失且界面毫无提示。
  it("does not connect before a session exists", () => {
    const { result } = renderHook(() => useAgentStream(null));

    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(result.current.connected).toBe(false);
  });

  it("refuses to send while no session exists instead of silently dropping it", () => {
    const { result } = renderHook(() => useAgentStream(null));

    act(() => result.current.sendMessage("分析这个数据集", { projectId: "project-1" }));

    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(result.current.lastError).toBeTruthy();
  });

  it("connects to the real session once it is ready", () => {
    const { rerender, result } = renderHook(({ id }: { id: string | null }) => useAgentStream(id), {
      initialProps: { id: null as string | null },
    });

    rerender({ id: "session-42" });
    openLatestSocket();

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0].url).toContain("/ws/sessions/session-42");
    expect(result.current.connected).toBe(true);
  });

  it("sends to the session that is actually connected", () => {
    const { rerender, result } = renderHook(({ id }: { id: string | null }) => useAgentStream(id), {
      initialProps: { id: null as string | null },
    });

    rerender({ id: "session-42" });
    const socket = openLatestSocket();
    act(() => result.current.sendMessage("分析这个数据集", { projectId: "project-1" }));

    expect(socket.sent).toHaveLength(1);
    expect(JSON.parse(socket.sent[0])).toMatchObject({
      type: "user_message",
      content: "分析这个数据集",
    });
  });
});
