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

## Changing where the token is stored

The JWT is read and written through the `TokenStore` interface in `lib/token-store.ts`. To store it somewhere else,
add an implementation in that file and assign it to `tokenStore`.

## Limits that come from the backend

- People are addressed by numeric user ID, because listing users is admin-only.
- Other people show as "User 14", because no endpoint returns another user's name.
- Messages aren't stored. A message sent to someone offline or disconnected is lost, and the UI marks it "Not delivered".
- History lives only in this browser's `localStorage`, and logging out deletes it.
