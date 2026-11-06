export type User = {
  id: number;
  fullName: string;
  email: string;
  createdAt: string;
  updatedAt: string;
};

type AuthResult = { token: string; email: string };
type Ticket = { ticket: string; expiresInSeconds: number };

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
  { method = "GET", body, token }: { method?: string; body?: unknown; token?: string } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: {
        ...(body !== undefined && { "Content-Type": "application/json" }),
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
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
};
