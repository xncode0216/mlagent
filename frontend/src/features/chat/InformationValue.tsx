import { AlertTriangle, Check, ChevronRight, Copy } from "lucide-react";
import { useState } from "react";

import { describeInformationValue } from "./informationDisplay";

async function writeClipboardText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  try {
    if (!document.execCommand?.("copy")) throw new Error("copy command was rejected");
  } finally {
    textarea.remove();
  }
}

type InformationValueProps = {
  label: string;
  value: string;
};

export function InformationValue({ label, value }: InformationValueProps) {
  const description = describeInformationValue(label, value);
  const [copyState, setCopyState] = useState<"error" | "idle" | "success">("idle");

  if (!description.expandable) {
    return (
      <code className="information-value-plain" title={value}>
        {description.display}
      </code>
    );
  }

  async function copyFullValue() {
    try {
      await writeClipboardText(value);
      setCopyState("success");
    } catch {
      setCopyState("error");
    }
  }

  return (
    <details className="information-value" data-information-kind={description.kind}>
      <summary title={`展开${label}完整值`}>
        <ChevronRight aria-hidden="true" className="information-value-chevron" size={13} />
        <span className="information-value-summary">
          <code>{description.display}</code>
          {description.context ? <small>{description.context}</small> : null}
        </span>
      </summary>
      <div className="information-value-expanded">
        <code title={value}>{value}</code>
        <button aria-label={`复制${label}完整值`} onClick={() => void copyFullValue()} type="button">
          {copyState === "success" ? (
            <Check aria-hidden="true" size={14} />
          ) : copyState === "error" ? (
            <AlertTriangle aria-hidden="true" size={14} />
          ) : (
            <Copy aria-hidden="true" size={14} />
          )}
          <span aria-live="polite">{copyState === "success" ? "已复制" : copyState === "error" ? "复制失败" : "复制"}</span>
        </button>
      </div>
    </details>
  );
}
