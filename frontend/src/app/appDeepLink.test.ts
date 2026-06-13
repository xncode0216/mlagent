import { describe, expect, it } from "vitest";

import { appPreferenceDefaults } from "./appPreferences";
import { parseAppDeepLink, resolveInitialMode } from "./appDeepLink";

describe("app deep links", () => {
  it("parses stable smoke-test entry parameters", () => {
    expect(
      parseAppDeepLink(
        "?mode=machine-learning&activity=experiments&rightTab=training&evolutionTab=graph&sessionId=session-1&projectId=project-1&file=data/customer_churn.csv&experimentId=exp-1",
      ),
    ).toEqual({
      activity: "experiments",
      evolutionTab: "graph",
      experimentId: "exp-1",
      file: "data/customer_churn.csv",
      mode: "machine-learning",
      projectId: "project-1",
      rightTab: "training",
      sessionId: "session-1",
    });
  });

  it("drops unknown modes, panels, and unsafe paths", () => {
    expect(
      parseAppDeepLink("?mode=unknown&activity=ghost&rightTab=preview&evolutionTab=timeline&file=../secret.csv"),
    ).toEqual({});
  });

  it("prefers deep-linked mode over local preferences", () => {
    expect(resolveInitialMode(appPreferenceDefaults, parseAppDeepLink("?mode=evolution"))).toBe("evolution");
    expect(
      resolveInitialMode(
        { ...appPreferenceDefaults, defaultMode: "machine-learning" },
        parseAppDeepLink("?mode=unknown"),
      ),
    ).toBe("machine-learning");
  });
});
