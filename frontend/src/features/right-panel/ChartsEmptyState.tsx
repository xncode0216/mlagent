import { BarChart3, Database, FileText, Play, RefreshCw, Table2 } from "lucide-react";
import { useState } from "react";

type ChartsEmptyAction = "profile" | "report" | "preprocess" | "clean" | "handoff";

export function ChartsEmptyState({
  onCleanDataset,
  onGenerateReport,
  onGenerateProfile,
  onGeneratePreprocessingPlan,
  onTransferToMl,
}: {
  onCleanDataset: () => Promise<void>;
  onGenerateReport: () => Promise<void>;
  onGenerateProfile: () => Promise<void>;
  onGeneratePreprocessingPlan: () => Promise<void>;
  onTransferToMl: () => Promise<void>;
}) {
  const [submitting, setSubmitting] = useState<ChartsEmptyAction | null>(null);

  async function runAction(action: ChartsEmptyAction, run: () => Promise<void>) {
    setSubmitting(action);
    try {
      await run();
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <div className="chart-gallery">
      <section className="charts-empty">
        <BarChart3 size={22} />
        <strong>还没有图表产物</strong>
        <p>运行数据画像、报告或预处理，生成的分布、相关性等图表会显示在这里。</p>
      </section>
      <div className="panel-actions">
        <button disabled={submitting !== null} onClick={() => void runAction("profile", onGenerateProfile)}>
          <Table2 size={15} />
          {submitting === "profile" ? "画像中..." : "生成画像"}
        </button>
        <button disabled={submitting !== null} onClick={() => void runAction("report", onGenerateReport)}>
          <FileText size={15} />
          {submitting === "report" ? "生成中..." : "生成报告"}
        </button>
        <button
          disabled={submitting !== null}
          onClick={() => void runAction("preprocess", onGeneratePreprocessingPlan)}
        >
          <RefreshCw size={15} />
          {submitting === "preprocess" ? "Planning..." : "Preprocess Plan"}
        </button>
        <button disabled={submitting !== null} onClick={() => void runAction("clean", onCleanDataset)}>
          <Database size={15} />
          {submitting === "clean" ? "清洗中..." : "清洗数据"}
        </button>
        <button disabled={submitting !== null} onClick={() => void runAction("handoff", onTransferToMl)}>
          <Play size={15} />
          {submitting === "handoff" ? "交接中..." : "传给 ML Agent"}
        </button>
      </div>
    </div>
  );
}
