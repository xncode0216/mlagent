import { SearchX } from "lucide-react";

import type { Artifact } from "../chat/types";

export function GuidedEmptyState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="empty-state compact-empty guided-empty" role="status">
      <SearchX aria-hidden="true" size={18} />
      <div>
        <strong>{title}</strong>
        <span>{description}</span>
      </div>
      {actionLabel && onAction ? (
        <button onClick={onAction} type="button">
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

export function ArtifactPathRow({
  downloadUrl,
  label,
  path,
  onOpen,
}: {
  downloadUrl?: string;
  label: string;
  path: string;
  onOpen: (path: string) => void;
}) {
  if (downloadUrl) {
    return (
      <div>
        <span>{label}</span>
        <a
          className="artifact-path-button"
          data-artifact-path={path}
          href={downloadUrl}
          title={`Download ${path}`}
        >
          <code>{path}</code>
          <span>Download</span>
        </a>
      </div>
    );
  }

  return (
    <div>
      <span>{label}</span>
      <button
        className="artifact-path-button"
        data-artifact-path={path}
        onClick={() => onOpen(path)}
        title={`Open ${path}`}
        type="button"
      >
        <code>{path}</code>
        <span>Open</span>
      </button>
    </div>
  );
}

export function ArtifactList({
  artifacts,
  selectedId,
  onSelect,
}: {
  artifacts: Artifact[];
  selectedId?: string;
  onSelect: (artifact: Artifact) => void;
}) {
  if (artifacts.length === 0) return null;

  return (
    <div className="artifact-list compact">
      {artifacts.map((artifact) => (
        <button
          className={artifact.id === selectedId ? "artifact-card selected" : "artifact-card"}
          key={artifact.id}
          onClick={() => onSelect(artifact)}
        >
          <div>
            <strong>{artifact.name}</strong>
            <span>{artifact.type}</span>
          </div>
          <code>{artifact.path}</code>
          <small>{artifact.created_at}</small>
        </button>
      ))}
    </div>
  );
}
