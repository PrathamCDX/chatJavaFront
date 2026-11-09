# Chat frontend

Next.js client for the Spring Boot backend in `../demo`.

- `/`: log in or sign up
- `/chat`: one-to-one messaging over the backend's WebSocket

## Run

Start the backend first, then:

```bash
cp .env.example .env
npm install
npm run dev
```

Open <http://localhost:3000>. Use `localhost`, not `127.0.0.1`: the backend's WebSocket only accepts
origins matching `WS_ALLOWED_ORIGINS`, which defaults to `http://localhost:[*]`.

## Configuration

Both settings live in `.env`, and the app won't start without them. `.env` is git-ignored, and `.env.example` is the template.

| Variable | Used by | Purpose |
| --- | --- | --- |
| `BACKEND_URL` | Next.js server | Where `/api/*` is proxied to |
| `NEXT_PUBLIC_WS_URL` | Browser | The backend's WebSocket URL |

`next build` bakes both values into the build, so rebuild after changing them.

## How it talks to the backend

- **REST** goes through a Next.js rewrite (`/api/*` to `BACKEND_URL`), because the backend sends no CORS headers.
- **WebSocket** connects straight to `NEXT_PUBLIC_WS_URL`, using a one-time ticket from `POST /ws/ticket`.
  Tickets last 30 seconds and work once, so every reconnect fetches a new one.
  The socket stays closed until the user presses Connect, including after a page reload.
  It reconnects by itself after a dropped connection, except when the backend closes it with code 4001
  (too many connections), since that would only close the user's next oldest connection.

## Changing where the token is stored

The JWT is read and written through the `TokenStore` interface in `lib/token-store.ts`. To store it somewhere else,
add an implementation in that file and assign it to `tokenStore`.

## Message status

- **Sent**: the backend has queued the message for the receiver. It keeps it until the receiver acks it, for up to 24 hours, and resends it each time they connect.
- **Delivered**: the receiver's app got the message and sent a `messageAck`. It acks every message it receives, repeats included.
- **Read**: the thread is open in a focused tab while connected.

"Delivered" and "Read" are best effort: the backend drops either one if the sender is offline at that moment, so a message can stay on "Sent" after it arrived.

## Images

**+** then **Photo** sends a JPEG or PNG of up to 50 MB (`lib/image-upload.ts`). The sender sees it right away, with upload progress, while the app:

1. Calls `POST /file/initiate` with the image's extension, size and part count, using the message's id as `messageId`.
2. Uploads it in 1 MB parts with `PUT /storage/{messageId}/parts/{n}`. A part that fails on the network or with a 5xx is retried twice.
3. Sends an `image` frame over the WebSocket once every part is uploaded.

Every step is safe to repeat, so **Send again** on a failed image starts the upload again. The receiver shows the image from `GET /file/{messageId}/content`, which needs no token, and acks it like a message.

## Limits that come from the backend

- People are addressed by numeric user ID, because listing users is admin-only.
- Other people show as "User 14", because no endpoint returns another user's name.
- The backend's queue is in memory, so a restart loses messages nobody has received yet. It holds 100 messages per receiver, and past that the sender sees "Receiver's queue is full".
- Anyone who has an image's message id can download it, because the backend serves files without a token.
- Messages live only in React state, so reloading the page or logging out loses them. Each conversation keeps its newest 100 messages, and the oldest are dropped first.
