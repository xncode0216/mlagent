import { useQuery } from "@tanstack/react-query";

import { getAuthSession, type AuthSession } from "../../lib/api";

export const authSessionQueryKey = ["auth-session"] as const;

export function useAuthSessionQuery(loadSession: () => Promise<AuthSession> = getAuthSession) {
  return useQuery<AuthSession>({
    queryKey: authSessionQueryKey,
    queryFn: () => loadSession(),
  });
}
