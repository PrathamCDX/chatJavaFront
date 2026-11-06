"use client";

import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  window.addEventListener("focus", onChange);
  window.addEventListener("blur", onChange);
  document.addEventListener("visibilitychange", onChange);
  return () => {
    window.removeEventListener("focus", onChange);
    window.removeEventListener("blur", onChange);
    document.removeEventListener("visibilitychange", onChange);
  };
}

/** Whether this tab is selected and its window has focus, so someone is likely looking at it. */
export function usePageFocused() {
  return useSyncExternalStore(
    subscribe,
    () => document.hasFocus(),
    () => false,
  );
}
