import type { FileItem } from "../../lib/api";

const fallbackItems: FileItem[] = [
  { name: "customer_churn.csv", path: "data/customer_churn.csv", type: "file" },
  { name: "eda.py", path: "notebooks/eda.py", type: "file" },
  { name: "profile.json", path: "results/profile.json", type: "file" },
  { name: "models", path: "models", type: "directory" },
  { name: "agent_schema", path: "agent_schema", type: "directory" },
  { name: "evolution", path: "evolution", type: "directory" },
];

type FileExplorerProps = {
  activePath: string;
  files: FileItem[];
  onSelect: (path: string) => void;
  onUpload: (file: File) => Promise<void>;
  status: string;
};

export function FileExplorer({
  activePath,
  files,
  onSelect,
  onUpload,
  status,
}: FileExplorerProps) {
  const visibleFiles = files.length > 0 ? files : fallbackItems;

  return (
    <div className="file-explorer">
      <div className="panel-title">项目文件</div>
      <label className="upload-control">
        上传 CSV
        <input
          accept=".csv,text/csv"
          type="file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void onUpload(file);
            event.currentTarget.value = "";
          }}
        />
      </label>
      <div className="sidebar-status">{status}</div>
      <ul className="file-list">
        {visibleFiles.map((item) => (
          <li key={item.path} className={item.path === activePath ? "selected" : ""}>
            <button onClick={() => onSelect(item.path)}>
              <span className="file-kind">{item.type === "directory" ? "DIR" : "CSV"}</span>
              <span>{item.path}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
