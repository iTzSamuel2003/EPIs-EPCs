"use client";

import { useEffect } from "react";
import type { RefObject } from "react";

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex=\"-1\"])",
].join(",");

export function useModalFocus(open: boolean, modalRef: RefObject<HTMLElement | null>, initialFocusSelector?: string) {
  useEffect(() => {
    if (!open) return;
    const previousActiveElement = document.activeElement as HTMLElement | null;
    const modal = modalRef.current;
    if (!modal) return;

    const focusableElements = () => Array.from(modal.querySelectorAll<HTMLElement>(focusableSelector)).filter((element) => element.offsetParent !== null);
    const initialElement = initialFocusSelector ? modal.querySelector<HTMLElement>(initialFocusSelector) : null;
    requestAnimationFrame(() => (initialElement ?? focusableElements()[0] ?? modal).focus());

    function keepFocusInside(event: KeyboardEvent) {
      if (event.key !== "Tab") return;
      const elements = focusableElements();
      if (!elements.length) {
        event.preventDefault();
        modalRef.current?.focus();
        return;
      }
      const firstElement = elements[0];
      const lastElement = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    }

    document.addEventListener("keydown", keepFocusInside);
    return () => {
      document.removeEventListener("keydown", keepFocusInside);
      requestAnimationFrame(() => previousActiveElement?.focus());
    };
  }, [initialFocusSelector, modalRef, open]);
}
