import { useQuery } from "@tanstack/react-query";

import { readProjectFileContent, type ProjectFileContent } from "../../lib/api";

export function projectFileContentQueryRoot(projectId: string | undefined) {
  return ["project-file-content", projectId] as const;
}

export function projectFileContentQueryKey(
  projectId: string | undefined,
  path: string | undefined,
  version = "current",
) {
  return [...projectFileContentQueryRoot(projectId), path, version] as const;
}

export function useProjectFileContentQuery(
  projectId: string | undefined,
  path: string | undefined,
  version = "current",
) {
  return useQuery<ProjectFileContent>({
    queryKey: projectFileContentQueryKey(projectId, path, version),
    queryFn: () => readProjectFileContent(projectId as string, path as string),
    enabled: Boolean(projectId && path),
  });
}
