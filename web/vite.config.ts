import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  plugins: [svelte()],
  // Shown in "About".
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: {
    proxy: {
      "/api": { target: "http://localhost:3000", ws: true },
      "/auth": "http://localhost:3000",
    },
  },
});
