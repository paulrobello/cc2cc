import type { NextConfig } from "next";

// Hub WebSocket URL for CSP connect-src (convert ws:// → wss:// for HTTPS deployments)
const hubWsUrl = process.env.NEXT_PUBLIC_CC2CC_HUB_WS_URL ?? "ws://localhost:3100";

/**
 * Content Security Policy for the dashboard.
 * Restricts resource origins to same-origin + the hub WebSocket endpoint.
 * Adjust if you add additional CDN resources or fonts.
 */
function buildCsp(): string {
  // unsafe-eval is required by Next.js HMR in development, but must be excluded in production.
  const scriptSrc =
    process.env.NODE_ENV === "development"
      ? "script-src 'self' 'unsafe-eval' 'unsafe-inline'"
      : "script-src 'self' 'unsafe-inline'";
  const directives = [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    `connect-src 'self' ${hubWsUrl} ${hubWsUrl.replace("ws://", "http://").replace("wss://", "https://")}`,
    "font-src 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
  ];
  return directives.join("; ");
}

const nextConfig: NextConfig = {
  output: "standalone",
  // Treat @cc2cc/shared as an external package resolved from workspace
  transpilePackages: ["@cc2cc/shared"],
  // Force webpack build mode (not Turbopack) for extensionAlias support
  // The shared package uses .js extensions in TypeScript source (ESM style)
  // which requires extensionAlias to resolve .js → .ts during compilation
  experimental: {
    // No turbopack options — use webpack
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: buildCsp(),
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
  webpack: (config) => {
    // The shared package uses .js extensions in TypeScript source (ESM style).
    // Tell webpack to resolve .js imports to .ts files so the source compiles correctly.
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".jsx": [".tsx", ".jsx"],
    };
    return config;
  },
};

export default nextConfig;
