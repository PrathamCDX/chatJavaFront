export type User = {
  id: number;
  fullName: string;
  email: string;
  createdAt: string;
  updatedAt: string;
};

type AuthResult = { token: string; email: string };
type Ticket = { ticket: string; expiresInSeconds: number };
export type FileDetails = { id: number; extension: string; sizeKb: number; messageId: string; parts: number };
/** Part numbers run from 0 to parts - 1; both lists are ascending. */
export type FileParts = { fileId: number; parts: number; uploaded: number[]; missing: number[] };

/** Shape of every backend response, success or failure. */
type Envelope<T> = { success: boolean; message: string; data: T };

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Per-field messages when the backend rejects a request body. */
    readonly fieldErrors: Record<string, string> = {},
  ) {
    super(message);
  }
}

const UNREACHABLE = "Can't reach the server. Is the backend running?";

async function request<T>(
  path: string,
  {
    method = "GET",
    body,
    token,
    signal,
  }: { method?: string; body?: unknown; token?: string; signal?: AbortSignal } = {},
): Promise<T> {
  // A Blob is sent as raw bytes, anything else as JSON
  const raw = body instanceof Blob;
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: {
        ...(body !== undefined && { "Content-Type": raw ? "application/octet-stream" : "application/json" }),
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: raw ? body : body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError(UNREACHABLE, 0);
  }

  // A non-JSON body means the proxy answered because the backend is down
  const envelope: Envelope<T> | null = await response.json().catch(() => null);
  if (!envelope) {
    throw new ApiError(UNREACHABLE, response.status);
  }
  if (!response.ok || !envelope.success) {
    const fieldErrors = response.status === 400 ? (envelope.data as Record<string, string> | null) : null;
    throw new ApiError(envelope.message, response.status, fieldErrors ?? {});
  }
  return envelope.data;
}

export const api = {
  login: (email: string, password: string) =>
    request<AuthResult>("/auth/login", { method: "POST", body: { email, password } }),
  signup: (fullName: string, email: string, password: string) =>
    request<AuthResult>("/auth/signup", { method: "POST", body: { fullName, email, password } }),
  me: (token: string) => request<User>("/users/me", { token }),
  wsTicket: (token: string) => request<Ticket>("/ws/ticket", { method: "POST", token }),
  /** Safe to repeat with the same details. */
  initiateFile: (
    token: string,
    file: { extension: string; sizeKb: number; messageId: string; parts: number },
    signal?: AbortSignal,
  ) => request<FileDetails>("/file/initiate", { method: "POST", body: file, token, signal }),
  /** Safe to repeat: a repeated part replaces the stored one. */
  putFilePart: (token: string, messageId: string, partNo: number, bytes: Blob, signal?: AbortSignal) =>
    request<unknown>(`/storage/${messageId}/parts/${partNo}`, { method: "PUT", body: bytes, token, signal }),
  /** Which parts the backend already has, so an upload can pick up where it stopped. */
  fileParts: (token: string, messageId: string, signal?: AbortSignal) =>
    request<FileParts>(`/storage/${messageId}/parts`, { token, signal }),
};

/** Where the backend serves a message's file. Public, so it works as an <img> src. */
export function fileContentUrl(messageId: string) {
  return `/api/file/${messageId}/content`;
}
