import { QueryClient } from "@tanstack/react-query";

/**
 * 统一的 QueryClient 工厂。默认刻意保守，以在迁移期保持与原先“useEffect 取一次数”
 * 一致的行为：不在窗口聚焦时自动重取、失败只重试一次、数据短时间内视为新鲜，避免
 * 引入额外的后台重取。需要轮询的查询（如 GPU 状态）由各自的 refetchInterval 控制。
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: 30_000,
      },
    },
  });
}
