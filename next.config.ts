import type { NextConfig } from "next";
import path from "path";

const nextConfig = {
  eslint: {
    // Warning: This allows production builds to successfully complete even if
    // your project has ESLint errors.
    ignoreDuringBuilds: false,
  },
  typescript: {
    // !! WARN !!
    // Dangerously allow production builds to successfully complete even if
    // your project has type errors.
    // ignoreBuildErrors: true, // Only if you also have type errors
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.googleusercontent.com",
      },
      {
        protocol: "https",
        hostname: "**.googleapis.com",
      },
    ],
  },
  // Pin tracing root to this project directory to avoid monorepo/root mis-detection
  outputFileTracingRoot: path.resolve(__dirname),
} as NextConfig;

export default nextConfig;
