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
  // id and timestamp come from the sender's client, so only sentAt can be trusted
  | {
      type: "message";
      id: string;
      senderId: number;
      text: string | null;
      url: string | null;
      timestamp: string;
      sentAt: string;
    }
  /** The server has queued my message for the receiver. */
  // url is the download path relative to the backend, e.g. /file/<id>/content
  | { type: "image"; id: string; senderId: number; url: string; timestamp: string; sentAt: string }
  | { type: "sent"; id: string; receiverId: number; sentAt: string }
  /** The receiver acked my message. Lost if I'm offline at that moment. */
  | { type: "delivered"; id: string; receiverId: number; deliveredAt: string }
  // The server can't check messageId, so only readerId and readAt can be trusted
  | { type: "readReceipt"; messageId: string; readerId: number; readAt: string }
  | { type: "pong"; serverTime: string }
  | { type: "error"; message: string };

export type ClientFrame =
  | { type: "message"; id: string; timestamp: string; receiverId: number; text: string | null; url: string | null }
  /** id is the messageId the image was uploaded under; every part must be uploaded first. */
  | { type: "image"; id: string; timestamp: string; receiverId: number }
  /** For both of these, receiverId is the user who sent the message. */
  | { type: "messageAck"; messageId: string; receiverId: number }
  | { type: "readReceipt"; messageId: string; receiverId: number };

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
        // Repeats need this too: the server resends a message on every connect until it's acked
        if ((event.type === "message" || event.type === "image") && ws.readyState === WebSocket.OPEN) {
          const ack: ClientFrame = { type: "messageAck", messageId: event.id, receiverId: event.senderId };
          ws.send(JSON.stringify(ack));
        }
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
  const send = useCallback((frame: ClientFrame) => {
    const ws = socket.current;
    if (ws?.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(frame));
    return true;
  }, []);

  return { status, problem, send, connect, disconnect };
}
