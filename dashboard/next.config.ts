import type { NextConfig } from "next";

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
