import { useAgentStream } from "../features/chat/useAgentStream";
import { AgentWorkspace } from "../features/chat/AgentWorkspace";
import { FileExplorer } from "../features/files/FileExplorer";
import { RightPanel } from "../features/right-panel/RightPanel";

export function AppShell() {
  const { connected, events, sendMessage } = useAgentStream("dev-session");

  return (
    <div className="app-shell">
      <header className="top-nav">
        <div className="brand">MLAgent</div>
        <nav className="mode-tabs">
          <button className="active">数据分析</button>
          <button>机器学习</button>
          <button>自进化知识</button>
        </nav>
        <div className="model-selector">Claude / DeepSeek / Local vLLM</div>
      </header>
      <aside className="file-sidebar">
        <FileExplorer />
      </aside>
      <AgentWorkspace events={events} sendMessage={sendMessage} />
      <RightPanel events={events} />
      <footer className="status-bar">
        {connected ? "WebSocket Connected" : "WebSocket Disconnected"}
      </footer>
    </div>
  );
}
