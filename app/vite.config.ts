import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Local API target. Defaults to the local Express server.
// Override with VITE_API_TARGET=https://your-domain.com for production proxying.
const API_TARGET = process.env.VITE_API_TARGET || "http://localhost:3001";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: API_TARGET,
        changeOrigin: true,
        secure: true,
      },
    },
  },
});
