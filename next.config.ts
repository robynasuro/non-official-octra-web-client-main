import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true, // Optional: buat mode strict React
  // Hapus experimental.instrumentationHook karena udah gak perlu
};

export default nextConfig;