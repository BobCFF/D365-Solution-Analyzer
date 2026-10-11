/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["jszip"],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          // Content-Security-Policy (with a per-request nonce) is set in src/middleware.ts
        ],
      },
      // API responses contain decrypted customer metadata: never let browsers or proxies cache them.
      { source: "/api/(.*)", headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }] },
    ];
  },
};
export default nextConfig;
