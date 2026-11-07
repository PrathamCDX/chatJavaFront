"use client";

import { useEffect, type RefObject } from "react";

/**
 * Keeps a position: fixed element exactly over the part of the page the user can see. An
 * on-screen keyboard shrinks that part without changing 100dvh, and the browser then
 * scrolls the whole page up to reveal the focused input.
 */
export function useFitVisualViewport(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const viewport = window.visualViewport;
    const element = ref.current;
    if (!viewport || !element) return;

    function fit() {
      // Pinch zoom shrinks the visible part too, but there the page should stay as it is
      if (!viewport || !element || viewport.scale > 1.01) return;
      element.style.top = `${viewport.offsetTop}px`;
      element.style.height = `${viewport.height}px`;
    }

    fit();
    viewport.addEventListener("resize", fit);
    viewport.addEventListener("scroll", fit);
    return () => {
      viewport.removeEventListener("resize", fit);
      viewport.removeEventListener("scroll", fit);
      element.style.top = "";
      element.style.height = "";
    };
  }, [ref]);
}
