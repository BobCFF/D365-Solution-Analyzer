/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["jszip"],
  poweredByHeader: false,
  async headers() {
    return [{
      source: "/(.*)",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
        { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
      ],
    }];
  },
};
export default nextConfig;
