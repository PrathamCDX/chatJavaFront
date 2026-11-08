"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { Conversation, Message } from "@/lib/chat-state";
import { IMAGE_ACCEPT, imageProblem } from "@/lib/image-upload";
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
  onSendImage: (file: File) => void;
  onResend: (message: Message) => void;
  onConnect: () => void;
  onBack: () => void;
};

export default function Thread({
  conversation,
  status,
  problem,
  onSend,
  onSendImage,
  onResend,
  onConnect,
  onBack,
}: Props) {
  const { peerId, messages } = conversation;
  const log = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  // Not messages.length: that stops changing once the conversation is full
  const newestKey = messages.at(-1)?.key;

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [newestKey]);

  // Opening the keyboard shortens the log from the bottom, which would hide the newest messages
  useEffect(() => {
    const element = log.current;
    if (!element) return;
    let height = element.clientHeight;
    const observer = new ResizeObserver(() => {
      element.scrollTop += height - element.clientHeight;
      height = element.clientHeight;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // An image gets its height only once it loads. If that pushed the bottom out of view, follow it
  function handleImageLoad(image: HTMLImageElement) {
    const element = log.current;
    if (!element) return;
    const fromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    if (fromBottom - image.offsetHeight < 48) bottom.current?.scrollIntoView({ block: "end" });
  }

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

      <div
        ref={log}
        role="log"
        aria-label={`Messages with user ${peerId}`}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
      >
        {messages.length === 0 ? (
          <p className="mt-8 text-center text-sm text-muted">
            Say hello. If User {peerId} is offline, they&apos;ll get your messages when they connect.
          </p>
        ) : (
          <ul className="space-y-2">
            {messages.map((message) => (
              <li key={message.key}>
                <Bubble
                  message={message}
                  onResend={() => onResend(message)}
                  canResend={status === "online"}
                  onImageLoad={handleImageLoad}
                />
              </li>
            ))}
          </ul>
        )}
        <div ref={bottom} />
      </div>

      <Composer disabled={status !== "online"} onSend={onSend} onSendImage={onSendImage} />
    </>
  );
}

function Bubble({
  message,
  onResend,
  canResend,
  onImageLoad,
}: {
  message: Message;
  onResend: () => void;
  canResend: boolean;
  onImageLoad: (image: HTMLImageElement) => void;
}) {
  const { mine, text, url, image, progress, sentAt, status, error, readAt } = message;
  const time = new Date(sentAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  // A read message clearly arrived, even if its ack was lost or hasn't come in yet
  const notice = !readAt && status === "failed" ? error : null;

  return (
    <div className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
      <div
        className={`max-w-[80%] rounded-2xl text-sm wrap-anywhere whitespace-pre-wrap md:max-w-[65%] ${
          image !== undefined ? "p-1" : "px-3.5 py-2"
        } ${
          mine ? "rounded-br-md bg-accent text-accent-foreground" : "rounded-bl-md bg-surface"
        } ${status === "sending" ? "opacity-70" : ""}`}
      >
        {image !== undefined && <ImagePreview src={image} onLoad={onImageLoad} />}
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
        {mine && !readAt && status === "sending" && (
          <span>{progress !== undefined ? `Uploading ${Math.round(progress * 100)}%` : "Sending…"}</span>
        )}
        {mine && !readAt && status === "sent" && <span>Sent</span>}
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

function ImagePreview({ src, onLoad }: { src: string; onLoad: (image: HTMLImageElement) => void }) {
  // The src that failed. Not a boolean: a new src (the backend's copy replacing the preview) gets its own try,
  // and keeping the same <img> shows the old picture until the new one loads
  const [failed, setFailed] = useState<string | null>(null);
  if (src === "" || failed === src) return <p className="px-2.5 py-1 italic opacity-80">Image unavailable</p>;
  return (
    <a href={src} target="_blank" rel="noopener noreferrer" className="block">
      {/* Not next/image: these are local previews or backend files of unknown size */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt="Image"
        onLoad={(event) => onLoad(event.currentTarget)}
        onError={() => setFailed(src)}
        className="block max-h-72 max-w-full rounded-xl object-contain"
      />
    </a>
  );
}

function Composer({
  disabled,
  onSend,
  onSendImage,
}: {
  disabled: boolean;
  onSend: (text: string | null, url: string | null) => void;
  onSendImage: (file: File) => void;
}) {
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [showUrl, setShowUrl] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const attach = useRef<HTMLDivElement>(null);
  const attachToggle = useRef<HTMLButtonElement>(null);
  const attachOptionsId = useId();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  // The options close on a click anywhere else, or on Escape
  useEffect(() => {
    if (!attachOpen) return;
    function handlePointerDown(event: PointerEvent) {
      if (!attach.current?.contains(event.target as Node)) setAttachOpen(false);
    }
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      setAttachOpen(false);
      attachToggle.current?.focus();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [attachOpen]);

  function pickImage(file: File | undefined) {
    if (!file) return;
    const problem = imageProblem(file);
    setImageError(problem);
    if (!problem) onSendImage(file);
  }

  const trimmedUrl = url.trim();
  const urlInvalid = trimmedUrl !== "" && !isHttpUrl(trimmedUrl);
  const canSend = !disabled && !urlInvalid && (text.trim() !== "" || trimmedUrl !== "");

  function submit() {
    if (!canSend) return;
    onSend(text.trim() || null, trimmedUrl || null);
    setText("");
    setUrl("");
    setShowUrl(false);
    // On a phone, losing focus closes the keyboard between messages
    textarea.current?.focus();
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
            autoFocus
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-base placeholder:text-muted md:text-sm"
          />
          {urlInvalid && <p className="mt-1 text-xs text-danger">Enter a full http or https link</p>}
        </div>
      )}
      {imageError && (
        <p role="alert" className="mb-2 text-xs text-danger">
          {imageError}
        </p>
      )}
      <div className="flex items-end gap-2">
        <input
          ref={picker}
          type="file"
          accept={IMAGE_ACCEPT}
          aria-label="Image to send"
          className="hidden"
          onChange={(event) => {
            pickImage(event.target.files?.[0]);
            // Lets the same file be picked again
            event.target.value = "";
          }}
        />
        <div ref={attach} className="relative shrink-0">
          <button
            ref={attachToggle}
            type="button"
            aria-label="Attach"
            aria-expanded={attachOpen}
            aria-controls={attachOptionsId}
            onClick={() => setAttachOpen(!attachOpen)}
            className="flex size-9 items-center justify-center rounded-full text-muted transition-colors hover:bg-subtle hover:text-foreground"
          >
            <svg
              viewBox="0 0 20 20"
              aria-hidden="true"
              className={`size-5 transition-transform ${attachOpen ? "rotate-45" : ""}`}
            >
              <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
          {attachOpen && (
            <div
              id={attachOptionsId}
              className="absolute bottom-full left-0 z-10 mb-2 w-40 overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-lg"
            >
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  setAttachOpen(false);
                  picker.current?.click();
                }}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-subtle disabled:opacity-50 disabled:hover:bg-transparent"
              >
                Photo
              </button>
              <button
                type="button"
                onClick={() => {
                  setAttachOpen(false);
                  setShowUrl(!showUrl);
                  // A hidden link would otherwise still be sent
                  setUrl("");
                }}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-subtle"
              >
                {showUrl ? "Remove link" : "Link"}
              </button>
            </div>
          )}
        </div>
        <textarea
          ref={textarea}
          aria-label="Message"
          rows={1}
          placeholder="Message"
          maxLength={MAX_TEXT}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
          className="field-sizing-content max-h-40 min-w-0 flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-base placeholder:text-muted md:text-sm"
        />
        <button
          type="submit"
          disabled={!canSend}
          onMouseDown={(event) => event.preventDefault()}
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
