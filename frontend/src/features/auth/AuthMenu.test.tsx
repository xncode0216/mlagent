// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { AuthMenu } from "./AuthMenu";
import type { AuthSession } from "../../lib/api";

function makeSession(overrides: Partial<AuthSession>): AuthSession {
  return { authenticated: false, user_id: null, auth_mode: "oidc", ...overrides };
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

    render(<AuthMenu loadSession={loadSession} signOut={signOut} />);

    await screen.findByText("alice");
    fireEvent.click(screen.getByRole("button", { name: /Account:/ }));
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
    // Initial mount fetch + a re-fetch after logout keeps the indicator honest.
    await waitFor(() => expect(loadSession).toHaveBeenCalledTimes(2));
  });

  it("starts the login redirect for an anonymous user", async () => {
    const loadSession = vi.fn(async () => makeSession({ authenticated: false }));
    const onSignIn = vi.fn();

    render(<AuthMenu loadSession={loadSession} onSignIn={onSignIn} />);

    await screen.findByText("Sign in");
    fireEvent.click(screen.getByRole("button", { name: /Account:/ }));
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it("shows no sign-in or sign-out actions in development mode", async () => {
    const loadSession = vi.fn(async () =>
      makeSession({ auth_mode: "development", authenticated: true, user_id: "dev-user" }),
    );

    render(<AuthMenu loadSession={loadSession} />);

    await screen.findByText("dev-user");
    fireEvent.click(screen.getByRole("button", { name: /Account:/ }));

    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
  });
});
