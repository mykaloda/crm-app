import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Fonts are read from disk for the PDF certificate and social images.
  outputFileTracingIncludes: { "/**": ["./assets/fonts/**"] },
  poweredByHeader: false,
};

export default nextConfig;
