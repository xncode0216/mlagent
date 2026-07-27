import { useQuery } from "@tanstack/react-query";

import { listTrainingRuns, type ExperimentRun } from "../../lib/api";

/** 训练实验记录（runs）的 queryKey 助手，供 invalidate 复用。 */
export function trainingRunsQueryKey(projectId: string | undefined) {
  return ["ml", "runs", projectId] as const;
}

/**
 * 训练实验记录查询：随 projectId 取数。训练/评估/导出等操作完成后，由调用方对
 * trainingRunsQueryKey 执行 invalidate 触发重取，替代原先手动的 setTrainingRuns。
 */
export function useTrainingRunsQuery(projectId: string | undefined) {
  return useQuery<ExperimentRun[]>({
    queryKey: trainingRunsQueryKey(projectId),
    queryFn: () => listTrainingRuns(projectId as string),
    enabled: Boolean(projectId),
  });
}
