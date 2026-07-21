import type { AuthSession } from "../../lib/api";

/**
 * Visual tone for the top-bar account indicator.
 * - `loading`: session request in flight
 * - `error`: session request failed (backend unreachable)
 * - `authenticated`: a browser session is established (OIDC)
 * - `anonymous`: OIDC is active but the user is not signed in
 * - `development`: auth is disabled; the backend acts as a fixed dev user
 */
export type AuthMenuTone = "loading" | "error" | "authenticated" | "anonymous" | "development";

/** Primary action the popover offers, driving which button (if any) is shown. */
export type AuthMenuAction = "none" | "sign-in" | "sign-out";

export type AuthMenuView = {
  tone: AuthMenuTone;
  /** Short label for the top-bar trigger (must fit a narrow pill). */
  label: string;
  /** Longer, human-readable detail for the popover / tooltip. */
  detail: string;
  action: AuthMenuAction;
};

type DescribeInput = {
  session: AuthSession | null;
  loading?: boolean;
  error?: string | null;
};

/**
 * Map the account request state into a renderable view. Pure so it can be
 * unit-tested without rendering the component.
 */
export function describeAuthSession({ session, loading, error }: DescribeInput): AuthMenuView {
  if (loading && !session) {
    return { tone: "loading", label: "Account…", detail: "Checking sign-in status…", action: "none" };
  }
  if (error) {
    return {
      tone: "error",
      label: "Account offline",
      detail: `Could not reach the authentication service: ${error}`,
      action: "none",
    };
  }
  if (!session) {
    return { tone: "loading", label: "Account…", detail: "Checking sign-in status…", action: "none" };
  }
  if (session.auth_mode === "development") {
    const who = session.user_id || "dev-user";
    return {
      tone: "development",
      label: who,
      detail: `Development mode — authentication is disabled. Acting as ${who}.`,
      action: "none",
    };
  }
  if (session.authenticated) {
    const who = session.user_id || "Signed in";
    return { tone: "authenticated", label: who, detail: `Signed in as ${who}.`, action: "sign-out" };
  }
  return { tone: "anonymous", label: "Sign in", detail: "You are not signed in.", action: "sign-in" };
}
