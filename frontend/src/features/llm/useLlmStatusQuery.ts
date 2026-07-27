import { useQuery } from "@tanstack/react-query";

import { getLlmStatus, type LlmStatus } from "../../lib/api";

export const llmStatusQueryKey = ["llm-status"] as const;

export function useLlmStatusQuery(loadStatus: () => Promise<LlmStatus> = getLlmStatus) {
  return useQuery<LlmStatus>({
    queryKey: llmStatusQueryKey,
    queryFn: () => loadStatus(),
  });
}
