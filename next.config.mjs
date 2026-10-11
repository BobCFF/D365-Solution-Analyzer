// Settings may use the project prefix D365_SolAna_ (preferred) or the conventional names.
// The browser needs the Supabase URL and anon key, so they are inlined at build time here: this is what lets them
// keep a private-looking name (Vercel warns about NEXT_PUBLIC_ prefixes). The anon key is public by design and
// protected by row-level security; never put a service-role key in either variable.
const pick = (name, fallback) => process.env[`D365_SolAna_${name}`]?.trim() || process.env[fallback];

/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["jszip"],
  poweredByHeader: false,
  env: {
    NEXT_PUBLIC_SUPABASE_URL: pick("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL") ?? "",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: pick("SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY") ?? "",
  },
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
