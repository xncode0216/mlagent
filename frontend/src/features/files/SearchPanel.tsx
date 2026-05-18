import { FileSearch, Search } from "lucide-react";
import { useEffect, useState } from "react";

import { searchProjectFiles, type FileSearchMatch } from "../../lib/api";

type SearchPanelProps = {
  projectId?: string;
  onSelect: (path: string) => void;
};

export function SearchPanel({ projectId, onSelect }: SearchPanelProps) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<FileSearchMatch[]>([]);
  const [status, setStatus] = useState("输入关键词搜索当前项目文件。");

  useEffect(() => {
    if (!projectId || !query.trim()) {
      setMatches([]);
      setStatus(projectId ? "输入关键词搜索当前项目文件。" : "请选择项目后搜索。");
      return;
    }

    let cancelled = false;
    setStatus("搜索中...");
    const timer = window.setTimeout(() => {
      searchProjectFiles(projectId, query.trim())
        .then((items) => {
          if (cancelled) return;
          setMatches(items);
          setStatus(items.length > 0 ? `找到 ${items.length} 个结果` : "没有匹配结果。");
        })
        .catch((error) => {
          if (cancelled) return;
          setMatches([]);
          setStatus(error instanceof Error ? error.message : "搜索失败");
        });
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [projectId, query]);

  return (
    <div className="file-explorer">
      <section className="workspace-panel" aria-label="项目搜索">
        <div className="workspace-header">
          <div>
            <span className="sidebar-kicker">SEARCH</span>
            <strong>项目搜索</strong>
          </div>
          <Search size={16} />
        </div>
        <input
          aria-label="搜索项目文件"
          className="sidebar-search-input"
          placeholder="搜索文件名或文本内容"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="sidebar-status">{status}</div>
      </section>

      <section className="file-section" aria-label="搜索结果">
        <div className="section-header">
          <span className="panel-title">搜索结果</span>
          <span className="sidebar-kicker">{matches.length}</span>
        </div>
        <ul className="search-result-list">
          {matches.map((match, index) => (
            <li key={`${match.path}-${match.match_type}-${match.line_number ?? 0}-${index}`}>
              <button onClick={() => onSelect(match.path)} type="button">
                <span className="file-icon">
                  <FileSearch size={14} />
                </span>
                <span>
                  <strong>{match.path}</strong>
                  <small>
                    {match.match_type === "content" && match.line_number ? `第 ${match.line_number} 行 · ` : ""}
                    {match.preview}
                  </small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
