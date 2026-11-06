"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError, type User } from "@/lib/api";
import { clearToken, useToken } from "@/lib/session";
import ChatApp from "./ChatApp";

/** Redirects anyone not logged in, and loads the user before the chat starts. */
export default function ChatGate() {
  const router = useRouter();
  const token = useToken();
  // Tied to its token: Next keeps this route mounted after logging out, and the
  // next login must not start with the previous person's user
  const [session, setSession] = useState<{ token: string; user: User } | null>(null);
  const user = session && session.token === token ? session.user : null;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (token === null) router.replace("/");
  }, [token, router]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    api
      .me(token)
      .then((me) => {
        if (!cancelled) setSession({ token, user: me });
      })
      .catch((caught: ApiError) => {
        if (cancelled) return;
        if (caught.status === 401) clearToken();
        else setError(caught.message);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (error) {
    return (
      <main className="flex flex-1 items-center justify-center px-4">
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      </main>
    );
  }
  if (!token || !user) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted">Loading…</p>
      </main>
    );
  }
  return <ChatApp key={user.id} user={user} token={token} />;
}
