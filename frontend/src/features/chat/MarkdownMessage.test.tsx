// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

import { MarkdownMessage } from "./MarkdownMessage";

afterEach(cleanup);

describe("MarkdownMessage", () => {
  it("renders GitHub-flavored markdown with bold text and tables", () => {
    render(
      <MarkdownMessage
        content={"Result is **significant**.\n\n| metric | value |\n| --- | --- |\n| acc | 0.87 |"}
      />,
    );

    expect(screen.getByText("significant").tagName).toBe("STRONG");
    const table = screen.getByRole("table");
    expect(within(table).getByText("metric")).toBeTruthy();
    expect(within(table).getByText("0.87")).toBeTruthy();
  });

  it("syntax-highlights fenced code blocks", () => {
    const { container } = render(
      <MarkdownMessage content={"```python\nimport pandas as pd\n```"} />,
    );

    const code = container.querySelector("pre code");
    expect(code?.className).toContain("hljs");
    expect(container.querySelector(".hljs-keyword")).toBeTruthy();
  });

  it("does not render raw HTML embedded in markdown", () => {
    const { container } = render(
      <MarkdownMessage content={'Hello <img src=x onerror="alert(1)"> world'} />,
    );

    // The tag must be escaped text, never a live element.
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img");
  });

  it("opens links in a new tab with noreferrer", () => {
    render(<MarkdownMessage content={"[docs](https://example.test)"} />);

    const link = screen.getByRole("link", { name: "docs" });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noreferrer");
  });
});
