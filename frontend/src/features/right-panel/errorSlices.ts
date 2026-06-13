import type { TrainingMetric } from "../../lib/api";

export type ErrorSlice = {
  label: string;
  support: number;
  correct: number;
  errors: number;
  errorRate: number;
  primaryConfusion: {
    label: string;
    count: number;
    rate: number;
  } | null;
};

export function deriveErrorSlices(metrics?: Pick<TrainingMetric, "confusion_matrix">): ErrorSlice[] {
  const confusion = metrics?.confusion_matrix;
  if (!confusion) return [];

  return Object.entries(confusion)
    .map(([label, predictions]) => {
      const entries = Object.entries(predictions ?? {});
      const support = entries.reduce((total, [, count]) => total + (Number.isFinite(count) ? count : 0), 0);
      const correct = Number.isFinite(predictions?.[label]) ? predictions[label] : 0;
      const errors = Math.max(0, support - correct);
      const primaryConfusionEntry = entries
        .filter(([predicted]) => predicted !== label)
        .sort((left, right) => right[1] - left[1])[0];

      return {
        label,
        support,
        correct,
        errors,
        errorRate: support > 0 ? errors / support : 0,
        primaryConfusion:
          primaryConfusionEntry && primaryConfusionEntry[1] > 0
            ? {
                label: primaryConfusionEntry[0],
                count: primaryConfusionEntry[1],
                rate: support > 0 ? primaryConfusionEntry[1] / support : 0,
              }
            : null,
      };
    })
    .filter((slice) => slice.support > 0)
    .sort((left, right) => right.errorRate - left.errorRate || right.errors - left.errors || left.label.localeCompare(right.label));
}
