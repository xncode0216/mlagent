import { describe, expect, it } from "vitest";

import type { AuthSession } from "../../lib/api";
import { describeAuthSession } from "./authSession";

function session(overrides: Partial<AuthSession>): AuthSession {
  return { authenticated: false, user_id: null, auth_mode: "oidc", ...overrides };
}

describe("describeAuthSession", () => {
  it("shows a loading tone while the first request is in flight", () => {
    const view = describeAuthSession({ session: null, loading: true });
    expect(view.tone).toBe("loading");
    expect(view.action).toBe("none");
  });

  it("shows an error tone with detail when the request failed", () => {
    const view = describeAuthSession({ session: null, error: "Failed to fetch" });
    expect(view.tone).toBe("error");
    expect(view.detail).toContain("Failed to fetch");
    expect(view.action).toBe("none");
  });

  it("keeps the last identity and sign-out action when a refresh fails", () => {
    const view = describeAuthSession({
      session: session({ authenticated: true, user_id: "alice" }),
      error: "Failed to refresh",
    });
    expect(view.tone).toBe("error");
    expect(view.label).toBe("alice");
    expect(view.detail).toContain("Signed in as alice");
    expect(view.action).toBe("sign-out");
  });

  it("treats a missing session as loading rather than crashing", () => {
    const view = describeAuthSession({ session: null });
    expect(view.tone).toBe("loading");
  });

  it("shows the dev user without sign-in/out actions in development mode", () => {
    const view = describeAuthSession({
      session: session({ auth_mode: "development", authenticated: true, user_id: "dev-user" }),
    });
    expect(view.tone).toBe("development");
    expect(view.label).toBe("dev-user");
    expect(view.detail).toContain("authentication is disabled");
    expect(view.action).toBe("none");
  });

  it("offers sign out with the subject when a browser session is established", () => {
    const view = describeAuthSession({
      session: session({ authenticated: true, user_id: "alice@example.test" }),
    });
    expect(view.tone).toBe("authenticated");
    expect(view.label).toBe("alice@example.test");
    expect(view.action).toBe("sign-out");
  });

  it("offers sign in when OIDC is active but the user is anonymous", () => {
    const view = describeAuthSession({ session: session({ authenticated: false }) });
    expect(view.tone).toBe("anonymous");
    expect(view.label).toBe("Sign in");
    expect(view.action).toBe("sign-in");
  });
});
