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
    return { tone: "loading", label: "账户…", detail: "正在检查登录状态…", action: "none" };
  }
  if (error && !session) {
    return {
      tone: "error",
      label: "账户离线",
      detail: `无法连接认证服务：${error}`,
      action: "none",
    };
  }
  if (!session) {
    return { tone: "loading", label: "账户…", detail: "正在检查登录状态…", action: "none" };
  }
  let current: AuthMenuView;
  if (session.auth_mode === "development") {
    const who = session.user_id || "dev-user";
    current = {
      tone: "development",
      label: who,
      detail: `开发模式——认证已禁用。当前身份：${who}。`,
      action: "none",
    };
  } else if (session.authenticated) {
    const who = session.user_id || "已登录";
    current = { tone: "authenticated", label: who, detail: `已登录为 ${who}。`, action: "sign-out" };
  } else {
    current = { tone: "anonymous", label: "登录", detail: "你尚未登录。", action: "sign-in" };
  }
  if (!error) return current;
  return {
    ...current,
    tone: "error",
    detail: current.detail,
  };
}
