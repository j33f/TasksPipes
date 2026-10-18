/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  plugins: [svelte()],
  // Shown in "About".
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // Unit tests (Vitest): browser build of Svelte, so that runes ($state, $derived) react as in the app.
  resolve: process.env.VITEST ? { conditions: ["browser"] } : undefined,
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,svelte}"],
      exclude: ["src/**/*.test.ts", "src/main.ts", "src/env.d.ts"],
      reporter: ["text-summary", "html", "lcov"],
      reportsDirectory: "coverage",
    },
  },
  server: {
    // The language files live at the root of the repository (locales/).
    fs: { allow: [".."] },
    proxy: {
      "/api": { target: "http://localhost:3000", ws: true },
      "/auth": "http://localhost:3000",
    },
  },
});
