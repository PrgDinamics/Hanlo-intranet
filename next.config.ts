import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // El importador recibe la plantilla Excel por Server Action
    serverActions: { bodySizeLimit: "4mb" },
  },
};

export default nextConfig;
