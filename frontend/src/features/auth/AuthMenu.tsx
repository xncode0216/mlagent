import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, LogIn, LogOut, RefreshCw, UserRound } from "lucide-react";

import { authLoginUrl, getAuthSession, logout, type AuthSession } from "../../lib/api";
import { useDialogFocus } from "../../lib/useDialogFocus";
import { describeAuthSession } from "./authSession";
import { authSessionQueryKey, useAuthSessionQuery } from "./useAuthSessionQuery";

type Props = {
  /** Injectable for tests; defaults to the real API call. */
  loadSession?: () => Promise<AuthSession>;
  /** Injectable for tests; defaults to the real logout call. */
  signOut?: () => Promise<void>;
  /** Injectable for tests; defaults to a full-page redirect to the backend login. */
  onSignIn?: () => void;
};

/**
 * Top-bar account entry that reflects the backend's real sign-in state and
 * exposes the browser login/logout flow. In development mode it shows the fixed
 * dev identity without sign-in/out actions; under OIDC it offers a sign-in
 * redirect when anonymous and a revocable sign-out when a session exists.
 */
export function AuthMenu({ loadSession = getAuthSession, signOut = logout, onSignIn }: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { dialogRef, onKeyDown } = useDialogFocus<HTMLDivElement>(open);
  const queryClient = useQueryClient();
  const sessionQuery = useAuthSessionQuery(loadSession);
  const signOutMutation = useMutation({
    mutationFn: signOut,
    onSuccess: async () => {
      queryClient.setQueryData<AuthSession>(authSessionQueryKey, (current) =>
        current ? { ...current, authenticated: false, user_id: null } : current,
      );
      await queryClient.invalidateQueries({ queryKey: authSessionQueryKey });
      setOpen(false);
    },
  });

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function handleSignIn() {
    if (onSignIn) {
      onSignIn();
      return;
    }
    window.location.assign(authLoginUrl());
  }

  function handleSignOut() {
    signOutMutation.mutate();
  }

  const session = sessionQuery.data ?? null;
  const sessionError = sessionQuery.error instanceof Error
    ? sessionQuery.error.message
    : sessionQuery.error
      ? String(sessionQuery.error)
      : null;
  const signOutError = signOutMutation.error instanceof Error
    ? signOutMutation.error.message
    : signOutMutation.error
      ? String(signOutMutation.error)
      : null;
  const view = describeAuthSession({ session, loading: sessionQuery.isPending, error: sessionError });
  const triggerDetail = sessionError && session
    ? `${view.detail} 刷新失败：${sessionError}`
    : view.detail;

  return (
    <div className="auth-menu" ref={containerRef}>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`账户：${triggerDetail}`}
        className="auth-menu-trigger"
        data-tone={view.tone}
        onClick={() => setOpen((value) => !value)}
        title={triggerDetail}
        type="button"
      >
        {view.action === "sign-in" ? <LogIn size={14} /> : <UserRound size={14} />}
        <span className="auth-menu-dot" data-tone={view.tone} />
        <span className="auth-menu-label">{view.label}</span>
        <ChevronDown size={14} />
      </button>
      {open ? (
        <div
          aria-busy={sessionQuery.isFetching || signOutMutation.isPending}
          aria-label="账户"
          className="auth-menu-popover"
          onKeyDown={onKeyDown}
          ref={dialogRef}
          role="dialog"
          tabIndex={-1}
        >
          <header className="auth-menu-popover-head">
            <span>账户</span>
            <button
              aria-label="刷新账户状态"
              className="auth-menu-refresh"
              disabled={sessionQuery.isFetching || signOutMutation.isPending}
              onClick={() => void sessionQuery.refetch()}
              type="button"
            >
              <RefreshCw aria-hidden="true" size={14} />
            </button>
          </header>
          {sessionQuery.isFetching ? (
            <p className="service-query-state progress" role="status">
              {session ? "正在刷新账户状态…" : "正在检查登录状态…"}
            </p>
          ) : null}
          <p className="auth-menu-detail" data-tone={view.tone}>
            {view.detail}
          </p>
          {sessionError ? (
            <div className="service-query-state error" role="alert">
              <span>{sessionError}</span>
              <button
                aria-label="重试账户状态"
                disabled={sessionQuery.isFetching}
                onClick={() => void sessionQuery.refetch()}
                type="button"
              >
                <RefreshCw aria-hidden="true" size={14} />
                重试
              </button>
            </div>
          ) : null}
          {signOutError ? (
            <div className="service-query-state error" role="alert">
              <span>{signOutError}</span>
              <button
                aria-label="重试登出"
                disabled={signOutMutation.isPending}
                onClick={handleSignOut}
                type="button"
              >
                <LogOut aria-hidden="true" size={14} />
                重试登出
              </button>
            </div>
          ) : null}
          {view.action === "sign-in" ? (
            <button className="auth-menu-action" onClick={handleSignIn} type="button">
              <LogIn size={14} />
              登录
            </button>
          ) : null}
          {view.action === "sign-out" ? (
            signOutError ? null : (
              <button
                className="auth-menu-action"
                disabled={signOutMutation.isPending}
                onClick={handleSignOut}
                type="button"
              >
                <LogOut aria-hidden="true" size={14} />
                {signOutMutation.isPending ? "正在登出…" : "登出"}
              </button>
            )
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
