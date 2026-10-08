import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The whole editor stack is browser-only; it is loaded with ssr:false.
  reactCompiler: false,
};

export default nextConfig;
