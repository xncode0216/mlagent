import { useEffect, useRef, useState } from "react";

import type { AgentStreamEvent } from "./types";

export function useAgentStream(sessionId: string) {
  const socketRef = useRef<WebSocket | null>(null);
  const [events, setEvents] = useState<AgentStreamEvent[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const socket = new WebSocket(`ws://127.0.0.1:8000/ws/sessions/${sessionId}`);
    socketRef.current = socket;
    socket.onopen = () => setConnected(true);
    socket.onclose = () => setConnected(false);
    socket.onmessage = (message) => {
      setEvents((current) => [...current, JSON.parse(message.data) as AgentStreamEvent]);
    };
    return () => socket.close();
  }, [sessionId]);

  function sendMessage(content: string, activeFile: string) {
    socketRef.current?.send(
      JSON.stringify({
        type: "user_message",
        content,
        context: { active_file: activeFile },
      }),
    );
  }

  return { connected, events, sendMessage };
}
