import { useQuery } from "@tanstack/react-query";

import { readProjectFileContent, type ProjectFileContent } from "../../lib/api";

export function useProjectFileContentQuery(
  projectId: string | undefined,
  path: string | undefined,
  version = "current",
) {
  return useQuery<ProjectFileContent>({
    queryKey: ["project-file-content", projectId, path, version],
    queryFn: () => readProjectFileContent(projectId as string, path as string),
    enabled: Boolean(projectId && path),
  });
}
