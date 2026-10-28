import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* Reuse the on-disk Turbopack module graph between dev restarts — keeps
     restart memory small so the 4GB cgroup fits the server + headless QA
     browser at the same time. */
  experimental: {
    turbopackFileSystemCacheForDev: true,
  },
  /* TASK-Tradesviz (184) — SheetJS is a large CJS/UMD bundle; letting
     Turbopack compile its module graph pushed the dev server past the 4GB
     cgroup limit (kernel OOM-kill on the first /api/import/parse request).
     As a server-external package it stays a plain require() at runtime:
     near-zero compile cost, same API. */
  serverExternalPackages: ["xlsx"],
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
