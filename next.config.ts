import type { NextConfig } from "next";

// Set in .env. Stop here if one is missing, rather than proxy to or connect to "undefined".
for (const name of ["BACKEND_URL", "NEXT_PUBLIC_WS_URL"]) {
  if (!process.env[name]) {
    throw new Error(`${name} is not set. Copy .env.example to .env and fill it in.`);
  }
}

// Without the trailing slash: "https://host/" would rewrite /api/auth/login to "//auth/login",
// which Spring Security rejects
const backendUrl = process.env.BACKEND_URL!.replace(/\/+$/, "");

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // The backend sends no CORS headers, so the browser can't call it directly.
  // REST goes through this same-origin proxy instead. The WebSocket doesn't need
  // it: the backend checks the Origin itself, and it connects straight to the backend.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${backendUrl}/:path*` }];
  },
};

export default nextConfig;
