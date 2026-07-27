import { useEffect, useRef, type KeyboardEvent, type RefObject } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type DialogFocusOptions = {
  /** Element to focus when the dialog opens; defaults to the dialog container. */
  initialFocus?: RefObject<HTMLElement | null>;
};

type DialogFocus<T extends HTMLElement> = {
  /** Attach to the dialog container so focus can be moved and trapped inside it. */
  dialogRef: RefObject<T | null>;
  /** Attach to the dialog container's `onKeyDown` to keep Tab focus inside. */
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
};

/**
 * Focus management for modal-style dialogs and popovers. When `active` becomes
 * true it remembers the currently focused element and moves focus into the
 * dialog (a caller-provided element or the container itself); while active it
 * keeps Tab focus cycling inside the dialog; when it deactivates it restores
 * focus to the element that opened it. It deliberately ignores non-Tab keys so
 * owners can keep their own Escape/close handling.
 */
export function useDialogFocus<T extends HTMLElement>(
  active: boolean,
  options: DialogFocusOptions = {},
): DialogFocus<T> {
  const dialogRef = useRef<T | null>(null);
  const initialFocus = options.initialFocus;

  useEffect(() => {
    if (!active) return;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (initialFocus?.current ?? dialogRef.current)?.focus();
    return () => previouslyFocused?.focus();
  }, [active, initialFocus]);

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Tab") return;
    const container = dialogRef.current;
    if (!container) return;
    const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable.at(-1)!;
    const current = document.activeElement;
    if (event.shiftKey && (current === first || current === container)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && current === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return { dialogRef, onKeyDown };
}
