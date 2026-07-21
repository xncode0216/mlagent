import { useEffect, useRef, useState } from "react";
import { ChevronDown, LogIn, LogOut, UserRound } from "lucide-react";

import { authLoginUrl, getAuthSession, logout, type AuthSession } from "../../lib/api";
import { describeAuthSession } from "./authSession";

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
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  function refresh() {
    let active = true;
    setLoading(true);
    setError(null);
    loadSession()
      .then((next) => {
        if (active) setSession(next ?? null);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }

  useEffect(() => refresh(), []);

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
    setBusy(true);
    setError(null);
    signOut()
      .then(() => {
        setOpen(false);
        refresh();
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setBusy(false);
      });
  }

  const view = describeAuthSession({ session, loading, error });

  return (
    <div className="auth-menu" ref={containerRef}>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Account: ${view.detail}`}
        className="auth-menu-trigger"
        data-tone={view.tone}
        onClick={() => setOpen((value) => !value)}
        title={view.detail}
        type="button"
      >
        {view.action === "sign-in" ? <LogIn size={14} /> : <UserRound size={14} />}
        <span className="auth-menu-dot" data-tone={view.tone} />
        <span className="auth-menu-label">{view.label}</span>
        <ChevronDown size={14} />
      </button>
      {open ? (
        <div aria-label="Account" className="auth-menu-popover" role="dialog">
          <header className="auth-menu-popover-head">
            <span>Account</span>
          </header>
          <p className="auth-menu-detail" data-tone={view.tone}>
            {view.detail}
          </p>
          {view.action === "sign-in" ? (
            <button className="auth-menu-action" onClick={handleSignIn} type="button">
              <LogIn size={14} />
              Sign in
            </button>
          ) : null}
          {view.action === "sign-out" ? (
            <button className="auth-menu-action" disabled={busy} onClick={handleSignOut} type="button">
              <LogOut size={14} />
              {busy ? "Signing out…" : "Sign out"}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
