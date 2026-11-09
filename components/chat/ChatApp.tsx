"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { ApiError, fileContentUrl, type User } from "@/lib/api";
import { chatReducer, newMessageId, type Message } from "@/lib/chat-state";
import { uploadImage } from "@/lib/image-upload";
import { clearToken } from "@/lib/session";
import { useChatSocket, type ClientFrame, type ServerEvent } from "@/lib/use-chat-socket";
import { useFitVisualViewport } from "@/lib/use-fit-visual-viewport";
import { usePageFocused } from "@/lib/use-page-focused";
import Sidebar from "./Sidebar";
import Thread from "./Thread";

type Pending = { peerId: number; key: string };
/** An image of mine that the backend hasn't confirmed yet. Kept so a failed send can be retried. */
type Upload = { file: File; preview: string; uploaded: boolean; controller?: AbortController };

// The backend sends a path; only accept the one shape it uses
const IMAGE_PATH = /^\/file\/([0-9a-f-]{36})\/content$/i;
/** The abort reason when the user pauses an upload, as opposed to leaving the page. */
const PAUSED = "paused";

export default function ChatApp({ user, token }: { user: User; token: string }) {
  // Lives only in this state, so a reload or logout loses it. Nothing is written to the browser.
  const [conversations, dispatch] = useReducer(chatReducer, {});
  const [activePeerId, setActivePeerId] = useState<number | null>(null);

  // Messages waiting for a reply. "sent" names its message, but "error" doesn't. The server
  // handles a connection's frames in order, so an error belongs to the oldest one still here.
  const pending = useRef<Pending[]>([]);
  const uploads = useRef(new Map<string, Upload>());

  // Leaving the page stops uploads; their messages are marked failed
  useEffect(() => {
    const current = uploads.current;
    return () => current.forEach((upload) => upload.controller?.abort());
  }, []);

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
      case "image": {
        const id = IMAGE_PATH.exec(event.url)?.[1];
        dispatch({
          type: "add",
          peerId: event.senderId,
          unread: event.senderId !== activePeerId,
          message: {
            key: event.id,
            mine: false,
            text: null,
            url: null,
            // An empty src shows as "Image unavailable"
            image: id ? fileContentUrl(id) : "",
            sentAt: event.sentAt,
          },
        });
        break;
      }
      case "sent": {
        pending.current = pending.current.filter(({ key }) => key !== event.id);
        dispatch({ type: "sent", peerId: event.receiverId, key: event.id, sentAt: event.sentAt });
        const upload = uploads.current.get(event.id);
        if (upload) {
          // The backend has the whole image now, so the local copy can go
          uploads.current.delete(event.id);
          URL.revokeObjectURL(upload.preview);
          dispatch({
            type: "update",
            peerId: event.receiverId,
            key: event.id,
            patch: { image: fileContentUrl(event.id) },
          });
        }
        break;
      }
      case "delivered":
        dispatch({ type: "delivered", peerId: event.receiverId, key: event.id });
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

  function transmit(frame: Extract<ClientFrame, { type: "message" | "image" }>) {
    const { receiverId: peerId, id: key } = frame;
    pending.current.push({ peerId, key });
    if (!send(frame)) {
      pending.current.pop();
      dispatch({ type: "update", peerId, key, patch: { status: "failed", error: "Not connected" } });
    }
  }

  function transmitText(peerId: number, key: string, text: string | null, url: string | null) {
    transmit({ type: "message", id: key, timestamp: new Date().toISOString(), receiverId: peerId, text, url });
  }

  // Uploads the image if that hasn't finished yet, then sends it
  async function transmitImage(peerId: number, key: string) {
    const upload = uploads.current.get(key);
    if (!upload) return;
    if (!upload.uploaded) {
      const controller = new AbortController();
      upload.controller = controller;
      dispatch({ type: "update", peerId, key, patch: { paused: undefined } });
      try {
        await uploadImage(token, key, upload.file, {
          signal: controller.signal,
          onProgress: (progress) => dispatch({ type: "update", peerId, key, patch: { progress } }),
        });
        upload.uploaded = true;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          clearToken();
          return;
        }
        // Paused: the message waits for Resume. Checked on this run's own signal, since a quick
        // Resume may already have started the next run
        if (controller.signal.reason === PAUSED) return;
        const message = controller.signal.aborted
          ? "Upload stopped"
          : error instanceof Error
            ? error.message
            : "Upload failed";
        dispatch({ type: "update", peerId, key, patch: { status: "failed", error: message, progress: undefined } });
        return;
      } finally {
        if (upload.controller === controller) upload.controller = undefined;
      }
      dispatch({ type: "update", peerId, key, patch: { progress: undefined } });
    }
    transmit({ type: "image", id: key, timestamp: new Date().toISOString(), receiverId: peerId });
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
    transmitText(peerId, key, text, url);
  }

  function handleSendImage(peerId: number, file: File) {
    const key = newMessageId();
    const preview = URL.createObjectURL(file);
    uploads.current.set(key, { file, preview, uploaded: false });
    const message: Message = {
      key,
      mine: true,
      text: null,
      url: null,
      image: preview,
      progress: 0,
      sentAt: new Date().toISOString(),
      status: "sending",
    };
    dispatch({ type: "add", peerId, message });
    transmitImage(peerId, key);
  }

  function handlePause(peerId: number, key: string) {
    const controller = uploads.current.get(key)?.controller;
    if (!controller) return;
    dispatch({ type: "update", peerId, key, patch: { paused: true } });
    // Drops the part in flight too; Resume sends it again
    controller.abort(PAUSED);
    // Lets Resume start right away, before the stopped run has finished unwinding
    uploads.current.get(key)!.controller = undefined;
  }

  function handleResume(peerId: number, key: string) {
    const upload = uploads.current.get(key);
    if (!upload || upload.controller) return;
    transmitImage(peerId, key);
  }

  function handleResend(peerId: number, message: Message) {
    dispatch({ type: "update", peerId, key: message.key, patch: { status: "sending", error: undefined } });
    if (uploads.current.has(message.key)) {
      transmitImage(peerId, message.key);
    } else {
      transmitText(peerId, message.key, message.text, message.url);
    }
  }

  const active = activePeerId !== null ? conversations[activePeerId] : undefined;
  const focused = usePageFocused();
  const shell = useRef<HTMLDivElement>(null);
  useFitVisualViewport(shell);

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
    <div ref={shell} className="fixed inset-x-0 top-0 flex h-dvh overflow-hidden">
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
            onSendImage={(file) => handleSendImage(active.peerId, file)}
            onResend={(message) => handleResend(active.peerId, message)}
            onPause={(message) => handlePause(active.peerId, message.key)}
            onResume={(message) => handleResume(active.peerId, message.key)}
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
