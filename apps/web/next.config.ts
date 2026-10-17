import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace package shipped as TypeScript source.
  transpilePackages: ["@aurora/api-client", "@aurora/measurements", "@aurora/body3d"],
  experimental: {
    agentFeedback: true,
  },
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
};

export default nextConfig;
