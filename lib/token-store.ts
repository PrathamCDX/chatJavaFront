/**
 * Where the JWT is kept. To change that, write another implementation and
 * assign it to `tokenStore` at the bottom of this file; nothing else needs to change.
 *
 * Methods are synchronous because React reads the token during render.
 * They only run in the browser, so implementations can use browser APIs.
 */
export interface TokenStore {
  /** The stored token, or null if there isn't one. */
  get(): string | null;
  set(token: string): void;
  clear(): void;
  /**
   * Calls `onChange` when the token changes outside this tab, such as a logout in
   * another tab. Returns a function that stops listening. Changes made through
   * this store don't need reporting. A store with nothing to watch returns a no-op.
   */
  subscribe(onChange: () => void): () => void;
}

const TOKEN_KEY = "chat.token";

export class LocalStorageTokenStore implements TokenStore {
  get() {
    return localStorage.getItem(TOKEN_KEY);
  }

  set(token: string) {
    localStorage.setItem(TOKEN_KEY, token);
  }

  clear() {
    localStorage.removeItem(TOKEN_KEY);
  }

  subscribe(onChange: () => void) {
    const handleStorage = ({ key }: StorageEvent) => {
      // A null key means all of localStorage was cleared
      if (key === TOKEN_KEY || key === null) onChange();
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }
}

export const tokenStore: TokenStore = new LocalStorageTokenStore();
