import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In dev the API runs on :8787; in production the server serves this build from the same origin.
const api = "http://localhost:8787";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/rentals": api,
      "/payment-config": api,
      "/devices": api,
      "/health": api,
      "/export.csv": api,
    },
  },
});
