// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { useDialogFocus } from "./useDialogFocus";

function Harness({ active, useInitial = false }: { active: boolean; useInitial?: boolean }) {
  const initialRef = useRef<HTMLButtonElement | null>(null);
  const { dialogRef, onKeyDown } = useDialogFocus<HTMLDivElement>(
    active,
    useInitial ? { initialFocus: initialRef } : {},
  );
  return (
    <div>
      <button data-testid="outside" type="button">
        outside
      </button>
      {active ? (
        <div data-testid="dialog" onKeyDown={onKeyDown} ref={dialogRef} role="dialog" tabIndex={-1}>
          <button data-testid="first" ref={initialRef} type="button">
            first
          </button>
          <button data-testid="second" type="button">
            second
          </button>
          <button data-testid="last" type="button">
            last
          </button>
        </div>
      ) : null}
    </div>
  );
}

afterEach(cleanup);

describe("useDialogFocus", () => {
  it("moves focus onto the dialog container when it activates", () => {
    const { rerender } = render(<Harness active={false} />);
    const outside = screen.getByTestId("outside");
    outside.focus();
    expect(document.activeElement).toBe(outside);

    rerender(<Harness active={true} />);
    expect(document.activeElement).toBe(screen.getByTestId("dialog"));
  });

  it("focuses the provided initial element instead of the container", () => {
    render(<Harness active={true} useInitial={true} />);
    expect(document.activeElement).toBe(screen.getByTestId("first"));
  });

  it("restores focus to the opener when it deactivates", () => {
    const { rerender } = render(<Harness active={false} />);
    const outside = screen.getByTestId("outside");
    outside.focus();

    rerender(<Harness active={true} />);
    expect(document.activeElement).toBe(screen.getByTestId("dialog"));

    rerender(<Harness active={false} />);
    expect(document.activeElement).toBe(outside);
  });

  it("wraps Tab from the last focusable back to the first", () => {
    render(<Harness active={true} />);
    const last = screen.getByTestId("last");
    last.focus();

    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByTestId("first"));
  });

  it("wraps Shift+Tab from the first focusable to the last", () => {
    render(<Harness active={true} />);
    const first = screen.getByTestId("first");
    first.focus();

    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByTestId("last"));
  });

  it("wraps Shift+Tab from the container itself to the last focusable", () => {
    render(<Harness active={true} />);
    const dialog = screen.getByTestId("dialog");
    expect(document.activeElement).toBe(dialog);

    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByTestId("last"));
  });

  it("ignores non-Tab keys so Escape handlers can run", () => {
    render(<Harness active={true} />);
    const dialog = screen.getByTestId("dialog");
    const event = fireEvent.keyDown(dialog, { key: "Escape" });
    // The hook must not consume Escape; the event stays defaultable for owners.
    expect(event).toBe(true);
  });
});
