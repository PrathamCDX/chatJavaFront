import { NextResponse, type NextRequest } from "next/server";

/**
 * Runs on the Next.js server for every /api request, before next.config.ts rewrites it to
 * BACKEND_URL. Headers set here reach the backend, including on <img> requests, which the
 * browser sends without any custom headers.
 */
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  // Without it, ngrok's free plan answers with a "You are about to visit" HTML page instead of the API
  headers.set("ngrok-skip-browser-warning", "true");
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: "/api/:path*",
};
