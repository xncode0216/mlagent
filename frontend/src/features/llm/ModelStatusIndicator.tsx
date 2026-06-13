import { useEffect, useRef, useState } from "react";
import { ChevronDown, Cpu, RefreshCw } from "lucide-react";

import { getLlmStatus, type LlmStatus } from "../../lib/api";
import { buildProviderRows, describeLlmStatus } from "./llmStatus";

type Props = {
  /** Injectable for tests; defaults to the real API call. */
  loadStatus?: () => Promise<LlmStatus>;
};

/**
 * Top-bar indicator that reflects the backend's *real* LLM configuration:
 * which provider/model is active and whether a usable client can be built.
 * Clicking it opens a popover listing the supported providers. It is a status
 * surface, not a runtime switch — the backend is configured via environment.
 */
export function ModelStatusIndicator({ loadStatus = getLlmStatus }: Props) {
  const [status, setStatus] = useState<LlmStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  function refresh() {
    let active = true;
    setLoading(true);
    setError(null);
    loadStatus()
      .then((next) => {
        if (active) setStatus(next);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }

  useEffect(() => refresh(), []);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const view = describeLlmStatus({ status, loading, error });
  const rows = buildProviderRows(status);

  return (
    <div className="model-status" ref={containerRef}>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Model service: ${view.detail}`}
        className="model-status-trigger"
        data-tone={view.tone}
        onClick={() => setOpen((value) => !value)}
        title={view.detail}
        type="button"
      >
        <Cpu size={14} />
        <span className="model-status-dot" data-tone={view.tone} />
        <span className="model-status-label">{view.label}</span>
        <ChevronDown size={14} />
      </button>
      {open ? (
        <div aria-label="Model service status" className="model-status-popover" role="dialog">
          <header className="model-status-popover-head">
            <span>Model service</span>
            <button
              aria-label="Refresh model status"
              className="model-status-refresh"
              disabled={loading}
              onClick={refresh}
              type="button"
            >
              <RefreshCw size={13} />
            </button>
          </header>
          <p className="model-status-detail" data-tone={view.tone}>
            {view.detail}
          </p>
          {rows.length > 0 ? (
            <ul className="model-status-providers">
              {rows.map((row) => (
                <li className="model-status-provider" data-state={row.state} key={row.id}>
                  <span className="model-status-provider-name">{row.label}</span>
                  <span className="model-status-provider-state">{row.stateLabel}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="model-status-hint">
            Configured on the backend via <code>MLAGENT_LLM_PROVIDER</code>.
          </p>
        </div>
      ) : null}
    </div>
  );
}
