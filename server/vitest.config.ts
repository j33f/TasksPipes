import { defineConfig } from "vitest/config";

// Unit tests: pure modules, no database or network (config only needs plausible values).
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    env: {
      DATABASE_URL: "postgres://unused@localhost:1/unused",
      APP_SECRET: "unit-test-secret-unit-test-secret-0123456789",
      APP_URL: "https://tasks.test",
      OUTLINE_URL: "https://outline.test",
      DEFAULT_LOCALE: "en",
    },
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
      reporter: ["text-summary", "html", "lcov"],
      reportsDirectory: "coverage/unit",
    },
  },
});
