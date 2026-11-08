"use client";

import { useState, type FormEvent } from "react";
import type { User } from "@/lib/api";
import type { Conversation } from "@/lib/chat-state";
import type { SocketStatus } from "@/lib/use-chat-socket";
import { Avatar } from "./Avatar";

const STATUS_LABEL: Record<SocketStatus, string> = {
  disconnected: "Disconnected",
  online: "Connected",
  connecting: "Connecting…",
  offline: "Reconnecting…",
};

type Props = {
  user: User;
  status: SocketStatus;
  problem: string | null;
  conversations: Conversation[];
  activePeerId: number | null;
  onOpen: (peerId: number) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onLogOut: () => void;
};

export default function Sidebar({
  user,
  status,
  problem,
  conversations,
  activePeerId,
  onOpen,
  onConnect,
  onDisconnect,
  onLogOut,
}: Props) {
  const sorted = [...conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return (
    <aside className="flex w-full flex-col border-border bg-surface md:border-r">
      <header className="border-b border-border p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-semibold">{user.fullName}</p>
            <p className="truncate text-xs text-muted">{user.email}</p>
          </div>
          <button type="button" onClick={onLogOut} className="shrink-0 text-xs text-muted hover:text-foreground">
            Log out
          </button>
        </div>
        <div className="mt-3 flex items-center justify-between text-xs">
          <span className="flex items-center gap-1.5 text-muted" role="status">
            <span
              aria-hidden
              className={`size-2 rounded-full ${status === "online" ? "bg-accent" : "bg-muted"}`}
            />
            {STATUS_LABEL[status]}
          </span>
          <span className="rounded-md bg-subtle px-2 py-1 font-mono">Your ID: {user.id}</span>
        </div>
        {status === "disconnected" && problem && (
          <p role="alert" className="mt-3 text-xs text-danger">
            {problem}. Close a tab you aren&apos;t using, or connect here to close your oldest connection.
          </p>
        )}
        {status === "disconnected" ? (
          <button
            type="button"
            onClick={onConnect}
            className="mt-3 w-full rounded-lg bg-accent py-2 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover"
          >
            Connect
          </button>
        ) : (
          <button
            type="button"
            onClick={onDisconnect}
            className="mt-3 w-full rounded-lg border border-border py-2 text-sm font-medium transition-colors hover:bg-subtle"
          >
            Disconnect
          </button>
        )}
      </header>

      <NewChatForm selfId={user.id} onOpen={onOpen} />

      <nav aria-label="Conversations" className="min-h-0 flex-1 overflow-y-auto">
        {sorted.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted">Your conversations will show up here.</p>
        ) : (
          <ul>
            {sorted.map((conversation) => (
              <li key={conversation.peerId}>
                <ConversationRow
                  conversation={conversation}
                  active={conversation.peerId === activePeerId}
                  onOpen={onOpen}
                />
              </li>
            ))}
          </ul>
        )}
      </nav>
    </aside>
  );
}

function ConversationRow({
  conversation: { peerId, messages, unread },
  active,
  onOpen,
}: {
  conversation: Conversation;
  active: boolean;
  onOpen: (peerId: number) => void;
}) {
  const last = messages.at(-1);
  const preview = last ? `${last.mine ? "You: " : ""}${last.image !== undefined ? "Photo" : (last.text ?? last.url)}` : "No messages yet";

  return (
    <button
      type="button"
      onClick={() => onOpen(peerId)}
      aria-current={active ? "true" : undefined}
      className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${
        active ? "bg-subtle" : "hover:bg-subtle/60"
      }`}
    >
      <Avatar peerId={peerId} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">User {peerId}</span>
        <span className="block truncate text-xs text-muted">{preview}</span>
      </span>
      {unread > 0 && (
        <span className="rounded-full bg-accent px-1.5 py-0.5 text-xs font-medium text-accent-foreground">
          <span className="sr-only">Unread messages: </span>
          {unread}
        </span>
      )}
    </button>
  );
}

function NewChatForm({ selfId, onOpen }: { selfId: number; onOpen: (peerId: number) => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const peerId = Number(value);
    if (!Number.isSafeInteger(peerId) || peerId <= 0) {
      setError("Enter a numeric user ID");
    } else if (peerId === selfId) {
      setError("That's your own ID");
    } else {
      setError(null);
      setValue("");
      onOpen(peerId);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="border-b border-border p-4">
      <label htmlFor="peerId" className="mb-1.5 block text-xs font-medium text-muted">
        New chat
      </label>
      <div className="flex gap-2">
        <input
          id="peerId"
          inputMode="numeric"
          placeholder="User ID"
          value={value}
          onChange={(event) => setValue(event.target.value.trim())}
          className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-base placeholder:text-muted md:text-sm"
        />
        <button
          type="submit"
          disabled={!value}
          className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-50"
        >
          Start
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-1.5 text-xs text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
