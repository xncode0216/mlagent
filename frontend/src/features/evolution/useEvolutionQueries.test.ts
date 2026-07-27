import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import {
  injectionLogsQueryKey,
  invalidateEvolutionKnowledgeQueries,
  knowledgeGraphQueryKey,
  lessonsQueryKey,
} from "./useEvolutionQueries";

describe("invalidateEvolutionKnowledgeQueries", () => {
  it("invalidates lessons, injection logs, and the derived knowledge graph together", async () => {
    const queryClient = new QueryClient();
    const projectId = "project-1";
    const keys = [lessonsQueryKey(projectId), injectionLogsQueryKey(projectId), knowledgeGraphQueryKey(projectId)];
    keys.forEach((queryKey) => queryClient.setQueryData(queryKey, []));

    await invalidateEvolutionKnowledgeQueries(queryClient, projectId);

    keys.forEach((queryKey) => expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(true));
  });
});
