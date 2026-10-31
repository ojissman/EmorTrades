import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
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
  /* SEO-UPGRADE · PHASE 7 — baseline security headers for every response.
     Deliberately NOT a restrictive CSP: this app relies on inline <style>
     blocks from component libraries and dynamic inline scripts (theme
     bootstrap); a nonce-based CSP would require instrumenting every third-
     party component — tracked as a follow-up. The set below is the safe
     high-value baseline (OWASP secure headers minus CSP). */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
      /* Private media + API responses must never be cached by shared caches. */
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
};

export default nextConfig;
