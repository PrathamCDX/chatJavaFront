"use client";

import { useSyncExternalStore } from "react";
import { tokenStore } from "./token-store";

const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const unsubscribe = tokenStore.subscribe(listener);
  return () => {
    listeners.delete(listener);
    unsubscribe();
  };
}

export function setToken(token: string) {
  tokenStore.set(token);
  notify();
}

export function clearToken() {
  tokenStore.clear();
  notify();
}

/** The JWT, null when logged out, undefined until the browser has been checked. */
export function useToken(): string | null | undefined {
  return useSyncExternalStore(
    subscribe,
    () => tokenStore.get(),
    () => undefined,
  );
}
