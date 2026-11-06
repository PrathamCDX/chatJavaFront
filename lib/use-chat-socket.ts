"use client";

import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { api, ApiError } from "./api";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL;
const MAX_RETRY_DELAY_MS = 30_000;
// The user went over their connection limit and this was their oldest connection.
// Reconnecting would only push out their next oldest, so tabs would keep kicking each other off.
const TOO_MANY_CONNECTIONS = 4001;

export type ServerEvent =
  | { type: "connected"; userId: number }
  | { type: "message"; id: string; senderId: number; text: string | null; url: string | null; sentAt: string }
  | { type: "sent"; id: string; receiverId: number; delivered: boolean; sentAt: string }
  | { type: "pong"; serverTime: string }
  | { type: "error"; message: string };

export type OutgoingMessage = { receiverId: number; text: string | null; url: string | null };

export type SocketStatus = "disconnected" | "connecting" | "online" | "offline";

type Handlers = {
  onEvent: (event: ServerEvent) => void;
  onDisconnect: () => void;
  onUnauthorized: () => void;
};

/**
 * Connection to /ws/chat. It stays closed until connect() is called; from then until
 * disconnect() it's kept open, reconnecting with backoff. Tickets are single-use, so each
 * attempt gets a new one. A 4001 close ends this like disconnect() does, leaving `problem` set.
 */
export function useChatSocket(token: string, handlers: Handlers) {
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<SocketStatus>("disconnected");
  const [problem, setProblem] = useState<string | null>(null);
  const socket = useRef<WebSocket | null>(null);

  const onEvent = useEffectEvent(handlers.onEvent);
  const onDisconnect = useEffectEvent(handlers.onDisconnect);
  const onUnauthorized = useEffectEvent(handlers.onUnauthorized);

  useEffect(() => {
    if (!enabled) return;

    let stopped = false;
    let attempts = 0;
    let retryTimer: ReturnType<typeof setTimeout>;

    function retry() {
      if (stopped) return;
      setStatus("offline");
      attempts += 1;
      retryTimer = setTimeout(open, Math.min(1000 * 2 ** (attempts - 1), MAX_RETRY_DELAY_MS));
    }

    async function open() {
      setStatus("connecting");

      let ticket: string;
      try {
        ({ ticket } = await api.wsTicket(token));
      } catch (error) {
        if (stopped) return;
        if (error instanceof ApiError && error.status === 401) {
          onUnauthorized();
          return;
        }
        setProblem(error instanceof Error ? error.message : "Couldn't connect");
        retry();
        return;
      }
      if (stopped) return;

      const ws = new WebSocket(`${WS_URL}?ticket=${encodeURIComponent(ticket)}`);
      socket.current = ws;

      ws.onmessage = ({ data }) => {
        const event: ServerEvent = JSON.parse(data);
        if (event.type === "connected") {
          attempts = 0;
          setProblem(null);
          setStatus("online");
        }
        onEvent(event);
      };
      ws.onclose = ({ code, reason }) => {
        if (socket.current === ws) socket.current = null;
        if (stopped) return;
        onDisconnect();
        if (code === TOO_MANY_CONNECTIONS) {
          setProblem("You have too many connections open, so this one was closed");
          setStatus("disconnected");
          setEnabled(false);
          return;
        }
        setProblem(reason || "Connection lost");
        retry();
      };
    }

    open();
    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      socket.current?.close();
      socket.current = null;
    };
  }, [token, enabled]);

  const connect = useCallback(() => {
    setProblem(null);
    setStatus("connecting");
    setEnabled(true);
  }, []);

  function disconnect() {
    setEnabled(false);
    setStatus("disconnected");
    setProblem(null);
    // The effect's cleanup closes the socket quietly, so report it here
    handlers.onDisconnect();
  }

  /** Returns false if there's no open connection to send on. */
  const send = useCallback((message: OutgoingMessage) => {
    const ws = socket.current;
    if (ws?.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify({ type: "message", ...message }));
    return true;
  }, []);

  return { status, problem, send, connect, disconnect };
}
