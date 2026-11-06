"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { Conversation, Message } from "@/lib/chat-state";
import type { SocketStatus } from "@/lib/use-chat-socket";
import { Avatar } from "./Avatar";

// The backend's limits for a message
const MAX_TEXT = 2000;
const MAX_URL = 2048;

type Props = {
  conversation: Conversation;
  status: SocketStatus;
  problem: string | null;
  onSend: (text: string | null, url: string | null) => void;
  onResend: (message: Message) => void;
  onConnect: () => void;
  onBack: () => void;
};

export default function Thread({ conversation, status, problem, onSend, onResend, onConnect, onBack }: Props) {
  const { peerId, messages } = conversation;
  const bottom = useRef<HTMLDivElement>(null);
  // Not messages.length: that stops changing once the conversation is full
  const newestKey = messages.at(-1)?.key;

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [newestKey]);

  return (
    <>
      <header className="flex items-center gap-3 border-b border-border bg-surface px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to conversations"
          className="-ml-1 px-1 text-lg text-muted hover:text-foreground md:hidden"
        >
          ←
        </button>
        <Avatar peerId={peerId} />
        <h1 className="font-medium">User {peerId}</h1>
      </header>

      {status === "disconnected" && (
        <p role="status" className="bg-subtle px-4 py-2 text-center text-xs text-muted">
          {problem ? `${problem}.` : "You can't send or receive messages while disconnected."}{" "}
          <button type="button" onClick={onConnect} className="font-medium text-foreground underline">
            Connect
          </button>
        </p>
      )}
      {(status === "connecting" || status === "offline") && (
        <p role="status" className="bg-subtle px-4 py-2 text-center text-xs text-muted">
          {problem ? `${problem}. ` : ""}
          {status === "offline" ? "Trying to reconnect…" : "Connecting…"}
        </p>
      )}

      <div role="log" aria-label={`Messages with user ${peerId}`} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <p className="mt-8 text-center text-sm text-muted">
            Say hello. Messages only reach User {peerId} while they&apos;re online.
          </p>
        ) : (
          <ul className="space-y-2">
            {messages.map((message) => (
              <li key={message.key}>
                <Bubble message={message} onResend={() => onResend(message)} canResend={status === "online"} />
              </li>
            ))}
          </ul>
        )}
        <div ref={bottom} />
      </div>

      <Composer disabled={status !== "online"} onSend={onSend} />
    </>
  );
}

function Bubble({
  message,
  onResend,
  canResend,
}: {
  message: Message;
  onResend: () => void;
  canResend: boolean;
}) {
  const { mine, text, url, sentAt, status, error, readAt } = message;
  const time = new Date(sentAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  // A read message clearly arrived, even if its ack was lost or hasn't come in yet
  const notice = readAt
    ? null
    : status === "undelivered"
      ? "Not delivered: they're offline"
      : status === "failed"
        ? error
        : null;

  return (
    <div className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm wrap-anywhere whitespace-pre-wrap md:max-w-[65%] ${
          mine ? "rounded-br-md bg-accent text-accent-foreground" : "rounded-bl-md bg-surface"
        } ${status === "sending" ? "opacity-70" : ""}`}
      >
        {text}
        {url && (
          <a
            href={/^https?:\/\//i.test(url) ? url : undefined}
            target="_blank"
            rel="noopener noreferrer"
            className={`underline ${text ? "mt-1 block" : ""}`}
          >
            {url}
          </a>
        )}
      </div>
      <p className="mt-0.5 flex gap-1.5 px-1 text-[11px] text-muted">
        <span>{time}</span>
        {mine && readAt && <span>Read</span>}
        {mine && !readAt && status === "sending" && <span>Sending…</span>}
        {mine && !readAt && status === "delivered" && <span>Delivered</span>}
        {notice && <span className="text-danger">{notice}</span>}
        {notice && canResend && (
          <button type="button" onClick={onResend} className="font-medium underline hover:text-foreground">
            Send again
          </button>
        )}
      </p>
    </div>
  );
}

function Composer({
  disabled,
  onSend,
}: {
  disabled: boolean;
  onSend: (text: string | null, url: string | null) => void;
}) {
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [showUrl, setShowUrl] = useState(false);

  const trimmedUrl = url.trim();
  const urlInvalid = trimmedUrl !== "" && !isHttpUrl(trimmedUrl);
  const canSend = !disabled && !urlInvalid && (text.trim() !== "" || trimmedUrl !== "");

  function submit() {
    if (!canSend) return;
    onSend(text.trim() || null, trimmedUrl || null);
    setText("");
    setUrl("");
    setShowUrl(false);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    submit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // isComposing: Enter is confirming IME input, not sending
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="border-t border-border bg-surface p-3">
      {showUrl && (
        <div className="mb-2">
          <input
            type="url"
            aria-label="Link to send"
            placeholder="https://example.com"
            maxLength={MAX_URL}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted"
          />
          {urlInvalid && <p className="mt-1 text-xs text-danger">Enter a full http or https link</p>}
        </div>
      )}
      <div className="flex items-end gap-2">
        <button
          type="button"
          onClick={() => setShowUrl(!showUrl)}
          aria-expanded={showUrl}
          className="rounded-lg px-2 py-2 text-sm text-muted hover:text-foreground"
        >
          Link
        </button>
        <textarea
          aria-label="Message"
          rows={1}
          placeholder="Message"
          maxLength={MAX_TEXT}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
          className="field-sizing-content max-h-40 min-w-0 flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted"
        />
        <button
          type="submit"
          disabled={!canSend}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-50"
        >
          Send
        </button>
      </div>
      {text.length > MAX_TEXT - 200 && (
        <p className="mt-1 text-right text-xs text-muted">
          {text.length} / {MAX_TEXT}
        </p>
      )}
    </form>
  );
}

function isHttpUrl(value: string) {
  try {
    const { protocol, hostname } = new URL(value);
    return (protocol === "http:" || protocol === "https:") && hostname !== "";
  } catch {
    return false;
  }
}
