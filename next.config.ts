import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "unpdf", "mammoth", "tesseract.js", "@tesseract.js-data/eng", "@napi-rs/canvas", "pdf-lib"],
  experimental: {
    serverActions: { bodySizeLimit: "200mb" },
  },
};

export default nextConfig;
