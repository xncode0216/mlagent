export function AppShell() {
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
      <main className="agent-workspace">数据分析 Agent</main>
      <section className="right-panel">图表 / 代码 / 数据 / 训练 / 日志</section>
      <footer className="status-bar">Kernel Ready · WebSocket Connected · CPU/MEM</footer>
    </div>
  );
}
