import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: "0.0.0.0",
    // Proxy /api/* and /media/* to the bot service so the web app and the bot can
    // share a single public origin (one cloudflared tunnel covers both).
    proxy: {
      "/api": { target: "http://bot:8080", changeOrigin: true },
      "/media": { target: "http://bot:8080", changeOrigin: true }
    },
    // Allow access from arbitrary cloudflared tunnel hostnames.
    allowedHosts: true
  },
  preview: {
    port: 3000,
    host: "0.0.0.0",
    allowedHosts: true
  }
});
