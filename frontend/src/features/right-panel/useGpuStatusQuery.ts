import { useQuery } from "@tanstack/react-query";

import { getGPUStatus, type GPUStatus } from "../../lib/api";

/** GPU 状态查询的 queryKey 助手，供命令式 setQueryData / invalidate 复用。 */
export function gpuStatusQueryKey(projectId: string | undefined) {
  return ["gpu", "status", projectId] as const;
}

/**
 * GPU 状态查询：按 refetchInterval 轮询（替代原先的 setInterval effect）。
 * 仅在选中项目时启用；轮询间隔由 preferences.gpuRefreshIntervalMs 驱动，
 * 改动偏好会即时改变轮询节奏。
 */
export function useGpuStatusQuery(projectId: string | undefined, refetchIntervalMs: number) {
  return useQuery<GPUStatus>({
    queryKey: gpuStatusQueryKey(projectId),
    queryFn: () => getGPUStatus(projectId as string),
    enabled: Boolean(projectId),
    refetchInterval: refetchIntervalMs,
  });
}
