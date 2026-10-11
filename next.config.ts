import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "unpdf", "mammoth"],
  experimental: {
    serverActions: { bodySizeLimit: "200mb" },
  },
};

export default nextConfig;
