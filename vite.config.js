import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Capacitor loads the built app from the filesystem inside the
  // Android WebView, so asset paths must be relative, not root-based.
  base: "./",
  build: {
    outDir: "dist",
  },
});
