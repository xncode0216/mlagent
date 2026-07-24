// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";

import { AuthMenu } from "./AuthMenu";
import type { AuthSession } from "../../lib/api";

function makeSession(overrides: Partial<AuthSession>): AuthSession {
  return { authenticated: false, user_id: null, auth_mode: "oidc", ...overrides };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function renderMenu(props: Parameters<typeof AuthMenu>[0]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return render(<AuthMenu {...props} />, { wrapper: Wrapper });
}

// vitest runs without `globals`, so Testing Library's auto-cleanup is not
// registered; unmount between cases to avoid duplicate DOM across renders.
afterEach(cleanup);

describe("AuthMenu", () => {
  it("signs out an authenticated user and refetches the session", async () => {
    let calls = 0;
    const loadSession = vi.fn(async (): Promise<AuthSession> => {
      calls += 1;
      return calls === 1
        ? makeSession({ authenticated: true, user_id: "alice" })
        : makeSession({ authenticated: false });
    });
    const signOut = vi.fn(async () => {});

    renderMenu({ loadSession, signOut });

    await screen.findByText("alice");
    fireEvent.click(screen.getByRole("button", { name: /账户：/ }));
    fireEvent.click(screen.getByRole("button", { name: "登出" }));

    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
    // Initial mount fetch + a re-fetch after logout keeps the indicator honest.
    await waitFor(() => expect(loadSession).toHaveBeenCalledTimes(2));
  });

  it("commits the anonymous cache state when post-logout verification fails", async () => {
    const loadSession = vi
      .fn<() => Promise<AuthSession>>()
      .mockResolvedValueOnce(makeSession({ authenticated: true, user_id: "alice" }))
      .mockRejectedValueOnce(new Error("session verification failed"));
    const signOut = vi.fn(async () => {});
    renderMenu({ loadSession, signOut });

    await screen.findByText("alice");
    fireEvent.click(screen.getByRole("button", { name: /账户：/ }));
    fireEvent.click(screen.getByRole("button", { name: "登出" }));

    await screen.findByText("登录");
    expect(screen.getByRole("button", { name: /session verification failed/ })).toBeTruthy();
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(loadSession).toHaveBeenCalledTimes(2);
  });

  it("starts the login redirect for an anonymous user", async () => {
    const loadSession = vi.fn(async () => makeSession({ authenticated: false }));
    const onSignIn = vi.fn();

    renderMenu({ loadSession, onSignIn });

    await screen.findByText("登录");
    fireEvent.click(screen.getByRole("button", { name: /账户：/ }));
    fireEvent.click(screen.getByRole("button", { name: "登录" }));

    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it("shows no sign-in or sign-out actions in development mode", async () => {
    const loadSession = vi.fn(async () =>
      makeSession({ auth_mode: "development", authenticated: true, user_id: "dev-user" }),
    );

    renderMenu({ loadSession });

    await screen.findByText("dev-user");
    fireEvent.click(screen.getByRole("button", { name: /账户：/ }));

    expect(screen.queryByRole("button", { name: "登出" })).toBeNull();
    expect(screen.queryByRole("button", { name: "登录" })).toBeNull();
  });

  it("marks the account popover busy during the first session request", () => {
    const firstRead = deferred<AuthSession>();
    renderMenu({ loadSession: () => firstRead.promise });

    fireEvent.click(screen.getByRole("button", { name: /账户：/ }));
    const dialog = screen.getByRole("dialog", { name: "账户" });
    expect(dialog.getAttribute("aria-busy")).toBe("true");
    expect(within(dialog).getByRole("status").textContent).toContain("正在检查登录状态");
  });

  it("recovers from an initial session error through a local retry", async () => {
    const loadSession = vi
      .fn<() => Promise<AuthSession>>()
      .mockRejectedValueOnce(new Error("session API unavailable"))
      .mockResolvedValueOnce(makeSession({ authenticated: true, user_id: "alice" }));
    renderMenu({ loadSession });

    await waitFor(() => expect(screen.getByRole("button", { name: /session API unavailable/ })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /账户：/ }));
    const alert = await screen.findByRole("alert");
    fireEvent.click(within(alert).getByRole("button", { name: "重试账户状态" }));

    await screen.findByText("alice");
    expect(loadSession).toHaveBeenCalledTimes(2);
  });

  it("preserves the known identity when a background session refresh fails", async () => {
    const refresh = deferred<AuthSession>();
    const loadSession = vi
      .fn<() => Promise<AuthSession>>()
      .mockResolvedValueOnce(makeSession({ authenticated: true, user_id: "alice" }))
      .mockImplementationOnce(() => refresh.promise);
    renderMenu({ loadSession });

    await screen.findByText("alice");
    fireEvent.click(screen.getByRole("button", { name: /账户：/ }));
    const dialog = screen.getByRole("dialog", { name: "账户" });
    fireEvent.click(within(dialog).getByRole("button", { name: "刷新账户状态" }));

    await waitFor(() => expect(dialog.getAttribute("aria-busy")).toBe("true"));
    expect(within(dialog).getByText("正在刷新账户状态…")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "登出" })).toBeTruthy();

    refresh.reject(new Error("account refresh failed"));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain("account refresh failed");
    expect(within(dialog).getByText("已登录为 alice。")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "登出" })).toBeTruthy();
  });

  it("keeps the authenticated session actionable when sign-out fails", async () => {
    const loadSession = vi
      .fn<() => Promise<AuthSession>>()
      .mockResolvedValueOnce(makeSession({ authenticated: true, user_id: "alice" }))
      .mockResolvedValueOnce(makeSession({ authenticated: false }));
    const signOut = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("sign-out request failed"))
      .mockResolvedValueOnce(undefined);
    renderMenu({ loadSession, signOut });

    await screen.findByText("alice");
    fireEvent.click(screen.getByRole("button", { name: /账户：/ }));
    fireEvent.click(screen.getByRole("button", { name: "登出" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("sign-out request failed");
    expect(screen.getByText("已登录为 alice。")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重试登出" }));

    await screen.findByText("登录");
    expect(signOut).toHaveBeenCalledTimes(2);
    expect(loadSession).toHaveBeenCalledTimes(2);
  });
});
