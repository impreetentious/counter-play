import type { NextConfig } from "next";

// Static export: the product ships as files, with no server runtime to trust.
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
};

export default nextConfig;
