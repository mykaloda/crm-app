import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Fonts are read from disk for the PDF certificate and social images.
  outputFileTracingIncludes: { "/**": ["./assets/fonts/**"] },
  poweredByHeader: false,
  // Loaded from node_modules at runtime (WASM files / native protocol).
  serverExternalPackages: ["@electric-sql/pglite", "postgres"],
};

export default nextConfig;
