export type DeliveryStatus =
  | "sending"
  | "delivered"
  /** Accepted, but the receiver had no open connection. The backend doesn't store it, so it's gone. */
  | "undelivered"
  | "failed";

export type Message = {
  key: string;
  mine: boolean;
  text: string | null;
  url: string | null;
  sentAt: string;
  status?: DeliveryStatus;
  error?: string;
};

export type Conversation = {
  peerId: number;
  messages: Message[];
  unread: number;
  updatedAt: string;
};

export type ChatState = Record<number, Conversation>;

export type ChatAction =
  | { type: "open"; peerId: number }
  | { type: "add"; peerId: number; message: Message; unread?: boolean }
  | { type: "update"; peerId: number; key: string; patch: Partial<Message> };

function conversation(state: ChatState, peerId: number): Conversation {
  return state[peerId] ?? { peerId, messages: [], unread: 0, updatedAt: new Date().toISOString() };
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  const current = conversation(state, action.peerId);
  switch (action.type) {
    case "open":
      return { ...state, [action.peerId]: { ...current, unread: 0 } };
    case "add":
      return {
        ...state,
        [action.peerId]: {
          ...current,
          messages: [...current.messages, action.message],
          unread: current.unread + (action.unread ? 1 : 0),
          updatedAt: action.message.sentAt,
        },
      };
    case "update":
      return {
        ...state,
        [action.peerId]: {
          ...current,
          messages: current.messages.map((message) =>
            message.key === action.key ? { ...message, ...action.patch } : message,
          ),
        },
      };
  }
}

// The backend keeps no history, so this browser's copy is the only one
const historyKey = (userId: number) => `chat.history.${userId}`;

export function loadHistory(userId: number): ChatState {
  let state: ChatState;
  try {
    state = JSON.parse(localStorage.getItem(historyKey(userId)) ?? "{}");
  } catch {
    return {};
  }
  // A message still "sending" when the page closed will never get its ack
  for (const { messages } of Object.values(state)) {
    for (const message of messages) {
      if (message.status === "sending") {
        message.status = "failed";
        message.error = "Connection lost";
      }
    }
  }
  return state;
}

export function saveHistory(userId: number, state: ChatState) {
  try {
    localStorage.setItem(historyKey(userId), JSON.stringify(state));
  } catch {
    // Storage full or blocked: the chat still works, it just won't survive a reload
  }
}

export function clearHistory(userId: number) {
  localStorage.removeItem(historyKey(userId));
}
