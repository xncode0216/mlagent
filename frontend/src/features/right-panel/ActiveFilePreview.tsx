import { useQueryClient } from "@tanstack/react-query";
import { Download, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { projectFileDownloadUrl, updateProjectFileContent } from "../../lib/api";
import {
  projectFileContentQueryKey,
  useProjectFileContentQuery,
} from "../files/useProjectFileContentQuery";
import { filesQueryKeyRoot } from "../files/useProjectFilesQuery";
import { JsonTable } from "./ArtifactPreview";
import { parseCsvPreview } from "./csvPreview";
import { GuidedEmptyState } from "./PanelPrimitives";
import { activeFileReadError, BINARY_PREVIEW_MESSAGE, formatFileSize } from "./panelFormat";

function CsvFilePreview({ content }: { content: string }) {
  const preview = useMemo(() => parseCsvPreview(content), [content]);
  if (preview.headers.length === 0) {
    return <GuidedEmptyState description="添加表头和数据后，这里会显示可检查的表格预览。" title="CSV 文件为空" />;
  }

  return (
    <div aria-label="CSV 数据预览表，可滚动" className="data-preview" tabIndex={0}>
      <table>
        <thead>
          <tr>
            {preview.headers.map((header, index) => (
              <th key={`${header}-${index}`}>{header || `列 ${index + 1}`}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {preview.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {preview.headers.map((_, columnIndex) => (
                <td key={columnIndex}>{row[columnIndex] ?? ""}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ActiveFilePreview({
  activeFile,
  mode,
  onExecutePreprocessingPlan,
  projectId,
}: {
  activeFile: string;
  mode: "code" | "data";
  onExecutePreprocessingPlan?: () => Promise<void>;
  projectId?: string;
}) {
  const queryClient = useQueryClient();
  const fileContentQuery = useProjectFileContentQuery(projectId, activeFile);
  const fileContent = fileContentQuery.data ?? null;
  const readError = activeFileReadError(fileContentQuery.error);
  const isBinary = readError === BINARY_PREVIEW_MESSAGE;
  const fileKey = projectId && activeFile ? `${projectId}:${activeFile}` : "";
  const [draft, setDraft] = useState<{ fileKey: string; content: string } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const draftContent = draft?.fileKey === fileKey ? draft.content : fileContent?.content ?? "";

  useEffect(() => {
    setDraft(null);
    setSaveError(null);
    setSaveState("idle");
  }, [fileKey]);

  async function saveFile() {
    if (!projectId || !fileContent) return;
    setSaveState("saving");
    setSaveError(null);
    try {
      const result = await updateProjectFileContent(projectId, fileContent.path, draftContent);
      queryClient.setQueryData(projectFileContentQueryKey(projectId, fileContent.path), result);
      setDraft(null);
      setSaveState("saved");
      void queryClient.invalidateQueries({ queryKey: filesQueryKeyRoot(projectId) });
    } catch (nextError) {
      setSaveState("error");
      setSaveError(nextError instanceof Error ? nextError.message : "文件保存失败");
    }
  }

  const previewClassName = `active-file-preview ${mode === "data" ? "data-workspace" : "code-workspace"}`;

  if (!projectId) {
    return (
      <section aria-busy="false" aria-label="活动文件预览" className={previewClassName}>
        <GuidedEmptyState description="从左侧项目面板选择或创建项目，再打开需要检查的文件。" title="尚未选择项目" />
      </section>
    );
  }
  if (!activeFile) {
    return (
      <section aria-busy="false" aria-label="活动文件预览" className={previewClassName}>
        <GuidedEmptyState description="从左侧文件树选择 CSV、JSON 或代码文件进行检查。" title="尚未选择文件" />
      </section>
    );
  }
  if (fileContentQuery.isFetching && !fileContent) {
    return (
      <section aria-busy="true" aria-label="活动文件预览" className={previewClassName}>
        <div className="active-file-loading" role="status">
          <span>正在读取文件内容…</span>
          <div aria-hidden="true" className="inspector-skeleton">
            <span className="inspector-skeleton-row" />
            <span className="inspector-skeleton-row" />
            <span className="inspector-skeleton-row" />
          </div>
        </div>
      </section>
    );
  }
  if (readError && !fileContent) {
    return (
      <section aria-busy={fileContentQuery.isFetching} aria-label="活动文件预览" className={previewClassName}>
        <div className="inspector-async-state error" role="alert">
          <span>{readError}</span>
          {isBinary ? (
            <a
              aria-label="下载二进制文件"
              download
              href={projectFileDownloadUrl(projectId, activeFile)}
            >
              <Download aria-hidden="true" size={14} />
              下载文件
            </a>
          ) : (
            <button
              aria-label="重试文件内容"
              disabled={fileContentQuery.isFetching}
              onClick={() => void fileContentQuery.refetch()}
              type="button"
            >
              <RefreshCw aria-hidden="true" size={14} />
              重试
            </button>
          )}
        </div>
      </section>
    );
  }
  if (!fileContent) return null;

  const isCsv = activeFile.toLowerCase().endsWith(".csv") || fileContent.mime_type === "text/csv";
  const isJson = activeFile.toLowerCase().endsWith(".json") || fileContent.mime_type === "application/json";
  const hasUnsavedDraft = draftContent !== fileContent.content;

  return (
    <section aria-busy={fileContentQuery.isFetching} aria-label="活动文件预览" className={previewClassName}>
      <div className="dataset-strip">
        <div className="active-file-identity">
          <span>当前文件</span>
          <strong title={fileContent.path}>{fileContent.path}</strong>
        </div>
        <button
          aria-label="刷新文件内容"
          className="active-file-refresh"
          disabled={fileContentQuery.isFetching}
          onClick={() => void fileContentQuery.refetch()}
          title="刷新文件内容"
          type="button"
        >
          <RefreshCw aria-hidden="true" size={14} />
        </button>
      </div>
      <div className="file-meta-row">
        <span>{fileContent.mime_type}</span>
        <span>{formatFileSize(fileContent.size)}</span>
        {fileContentQuery.isFetching ? <span role="status">正在刷新文件内容…</span> : null}
        {mode === "code" && hasUnsavedDraft ? <span>未保存</span> : null}
        {mode === "code" && saveState === "saved" ? <span>已保存</span> : null}
      </div>
      {readError ? (
        <div className="inspector-async-state error" role="alert">
          <span>{readError}</span>
          <button
            aria-label="重试文件内容"
            disabled={fileContentQuery.isFetching}
            onClick={() => void fileContentQuery.refetch()}
            type="button"
          >
            <RefreshCw aria-hidden="true" size={14} />
            重试
          </button>
        </div>
      ) : null}
      {saveError ? (
        <div className="inspector-async-state error" role="alert">
          <span>{saveError}</span>
          <button disabled={saveState === "saving"} onClick={() => void saveFile()} type="button">
            重试保存
          </button>
        </div>
      ) : null}
      {mode === "data" && isCsv ? <CsvFilePreview content={fileContent.content} /> : null}
      {mode === "data" && isJson ? (
        (() => {
          try {
            return <JsonTable onExecutePreprocessingPlan={onExecutePreprocessingPlan} value={JSON.parse(fileContent.content)} />;
          } catch {
            return <pre className="json-preview">{fileContent.content}</pre>;
          }
        })()
      ) : null}
      {mode === "data" && !isCsv && !isJson ? (
        <pre className="json-preview">{fileContent.content}</pre>
      ) : null}
      {mode === "code" ? (
        <div className="code-editor">
          <textarea
            aria-label="文件内容编辑器"
            spellCheck={false}
            value={draftContent}
            onChange={(event) => {
              setDraft({ fileKey, content: event.target.value });
              setSaveState("idle");
              setSaveError(null);
            }}
          />
          <div className="editor-actions">
            <button
              disabled={saveState === "saving" || !hasUnsavedDraft}
              onClick={() => void saveFile()}
              type="button"
            >
              {saveState === "saving" ? "保存中..." : "保存文件"}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
