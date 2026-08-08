import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Apply a minimal-but-correct header policy to every response. We
        // don't set CSP — the redirector has no inline scripts of its own
        // and Next.js's per-chunk nonces would be a much larger change.
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          // HSTS for one year, including subdomains, preload-eligible. Vercel
          // already terminates TLS, so this only matters if the operator
          // ever moves to a custom domain.
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

export default nextConfig;