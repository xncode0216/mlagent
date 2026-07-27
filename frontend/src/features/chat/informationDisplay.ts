export type InformationValueDescription = {
  context?: string;
  display: string;
  expandable: boolean;
  kind: "identifier" | "path" | "plain";
  value: string;
};

const PATH_LABEL_PATTERN = /(路径|数据集|画像|计划|输出|报告|指标|模型|样本|导出包|产物|文件|path|dataset|artifact|report|metrics|model|samples|plan)/i;
const IDENTIFIER_LABEL_PATTERN = /(实验|会话|版本|任务|运行|审批|experiment|session|version|task|run|approval|\bid\b)/i;
const PLACEHOLDER_VALUES = new Set(["", "-", "无", "未知", "未生成", "未登记", "未选择", "等待执行", "缺失", "可选", "暂无产物"]);

function compactParentPath(parentSegments: string[]): string | undefined {
  if (parentSegments.length === 0) return undefined;
  if (parentSegments.length <= 2) return parentSegments.join("/");
  return `${parentSegments[0]}/…/${parentSegments.at(-1)}`;
}

export function friendlyPathName(value: string): string {
  const segments = value.replaceAll("\\", "/").split("/").filter(Boolean);
  return segments.at(-1) ?? value;
}

export function compactInformationIdentifier(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 22 ? `${trimmed.slice(0, 8)}…${trimmed.slice(-6)}` : trimmed;
}

export function describeInformationValue(label: string, value: string): InformationValueDescription {
  const trimmed = value.trim();
  const plain = (display = value): InformationValueDescription => ({
    display,
    expandable: false,
    kind: "plain",
    value,
  });

  if (PLACEHOLDER_VALUES.has(trimmed)) return plain(trimmed || "-");

  const normalizedPath = trimmed.replaceAll("\\", "/");
  if (PATH_LABEL_PATTERN.test(label) && normalizedPath.includes("/")) {
    const segments = normalizedPath.split("/").filter(Boolean);
    const display = friendlyPathName(normalizedPath);
    return {
      context: compactParentPath(segments.slice(0, -1)),
      display,
      expandable: display !== normalizedPath,
      kind: "path",
      value,
    };
  }

  if (IDENTIFIER_LABEL_PATTERN.test(label) && trimmed.length > 22 && !trimmed.includes(" ")) {
    return {
      context: `完整${label}标识`,
      display: compactInformationIdentifier(trimmed),
      expandable: true,
      kind: "identifier",
      value,
    };
  }

  return plain();
}
