"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import type { User } from "@/lib/api";
import { chatReducer, newMessageId, type Message } from "@/lib/chat-state";
import { clearToken } from "@/lib/session";
import { useChatSocket, type ServerEvent } from "@/lib/use-chat-socket";
import { usePageFocused } from "@/lib/use-page-focused";
import Sidebar from "./Sidebar";
import Thread from "./Thread";

type Pending = { peerId: number; key: string };

export default function ChatApp({ user, token }: { user: User; token: string }) {
  // Lives only in this state, so a reload or logout loses it. Nothing is written to the browser.
  const [conversations, dispatch] = useReducer(chatReducer, {});
  const [activePeerId, setActivePeerId] = useState<number | null>(null);

  // Messages waiting for a reply. "sent" names its message, but "error" doesn't. The server
  // handles a connection's frames in order, so an error belongs to the oldest one still here.
  const pending = useRef<Pending[]>([]);

  function handleEvent(event: ServerEvent) {
    switch (event.type) {
      case "message":
        dispatch({
          type: "add",
          peerId: event.senderId,
          unread: event.senderId !== activePeerId,
          message: { key: event.id, mine: false, text: event.text, url: event.url, sentAt: event.sentAt },
        });
        break;
      case "sent":
        pending.current = pending.current.filter(({ key }) => key !== event.id);
        dispatch({
          type: "update",
          peerId: event.receiverId,
          key: event.id,
          patch: { status: event.delivered ? "delivered" : "undelivered", sentAt: event.sentAt },
        });
        break;
      case "readReceipt":
        dispatch({ type: "read", peerId: event.readerId, key: event.messageId, readAt: event.readAt });
        break;
      case "error": {
        const failed = pending.current.shift();
        if (failed) {
          dispatch({ type: "update", ...failed, patch: { status: "failed", error: event.message } });
        }
        break;
      }
    }
  }

  function handleDisconnect() {
    // Whatever wasn't acked may or may not have arrived; it won't be acked now
    for (const lost of pending.current.splice(0)) {
      dispatch({ type: "update", ...lost, patch: { status: "failed", error: "Connection lost" } });
    }
  }

  const { status, problem, send, connect, disconnect } = useChatSocket(token, {
    onEvent: handleEvent,
    onDisconnect: handleDisconnect,
    onUnauthorized: clearToken,
  });

  function transmit(peerId: number, key: string, text: string | null, url: string | null) {
    pending.current.push({ peerId, key });
    const frame = {
      type: "message",
      id: key,
      timestamp: new Date().toISOString(),
      receiverId: peerId,
      text,
      url,
    } as const;
    if (!send(frame)) {
      pending.current.pop();
      dispatch({ type: "update", peerId, key, patch: { status: "failed", error: "Not connected" } });
    }
  }

  function handleSend(peerId: number, text: string | null, url: string | null) {
    const key = newMessageId();
    const message: Message = {
      key,
      mine: true,
      text,
      url,
      sentAt: new Date().toISOString(),
      status: "sending",
    };
    dispatch({ type: "add", peerId, message });
    transmit(peerId, key, text, url);
  }

  function handleResend(peerId: number, message: Message) {
    dispatch({ type: "update", peerId, key: message.key, patch: { status: "sending", error: undefined } });
    transmit(peerId, message.key, message.text, message.url);
  }

  const active = activePeerId !== null ? conversations[activePeerId] : undefined;
  const focused = usePageFocused();

  // A message counts as read once its thread is open in a focused tab. Anything that
  // arrived earlier, or while disconnected, gets its receipt as soon as that's true.
  useEffect(() => {
    if (!active || !focused || status !== "online") return;
    for (const { key, mine, readReceiptSent } of active.messages) {
      if (mine || readReceiptSent) continue;
      if (send({ type: "readReceipt", messageId: key, receiverId: active.peerId })) {
        dispatch({ type: "update", peerId: active.peerId, key, patch: { readReceiptSent: true } });
      }
    }
  }, [active, focused, status, send]);

  function openConversation(peerId: number) {
    dispatch({ type: "open", peerId });
    setActivePeerId(peerId);
  }

  return (
    <div className="flex h-dvh overflow-hidden">
      <div className={`${active ? "hidden md:flex" : "flex"} w-full shrink-0 md:w-80`}>
        <Sidebar
          user={user}
          status={status}
          problem={problem}
          conversations={Object.values(conversations)}
          activePeerId={activePeerId}
          onOpen={openConversation}
          onConnect={connect}
          onDisconnect={disconnect}
          onLogOut={clearToken}
        />
      </div>
      <main className={`${active ? "flex" : "hidden md:flex"} min-w-0 flex-1 flex-col`}>
        {active ? (
          <Thread
            key={active.peerId}
            conversation={active}
            status={status}
            problem={problem}
            onSend={(text, url) => handleSend(active.peerId, text, url)}
            onResend={(message) => handleResend(active.peerId, message)}
            onConnect={connect}
            onBack={() => setActivePeerId(null)}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center px-6 text-center">
            <div className="max-w-xs">
              <p className="font-medium">No conversation open</p>
              <p className="mt-1 text-sm text-muted">
                Start one with someone&apos;s user ID. Share yours, #{user.id}, so people can reach you.
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
