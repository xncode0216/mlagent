import { useQuery } from "@tanstack/react-query";

import { listEvolutionProtocols, type EvolutionProtocol } from "../../lib/api";

/**
 * 进化协议（evolution protocols）是只读列表，从不被用户操作改写，因此非常适合
 * 用 react-query 托管：随 projectId 变化自动取数、自带缓存，免去 AppShell 里
 * 手动的 useState + 命令式加载。
 */
export function useEvolutionProtocolsQuery(projectId: string | undefined) {
  return useQuery<EvolutionProtocol[]>({
    queryKey: ["evolution", "protocols", projectId],
    queryFn: () => listEvolutionProtocols(projectId as string),
    enabled: Boolean(projectId),
  });
}
