import { useAgentStream } from "../features/chat/useAgentStream";

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
      <aside className="file-sidebar">项目文件</aside>
      <main className="agent-workspace">
        <h2>数据分析 Agent</h2>
        <button onClick={() => sendMessage("分析缺失值", "data/customer_churn.csv")}>
          发送示例分析请求
        </button>
        <pre>{events.map((event) => JSON.stringify(event)).join("\n")}</pre>
      </main>
      <section className="right-panel">图表 / 代码 / 数据 / 训练 / 日志</section>
      <footer className="status-bar">
        {connected ? "WebSocket Connected" : "WebSocket Disconnected"}
      </footer>
    </div>
  );
}
