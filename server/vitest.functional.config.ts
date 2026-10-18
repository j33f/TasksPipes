import { defineConfig } from "vitest/config";

/**
 * Functional tests: the whole API on a real PostgreSQL, against the fake Outline of dev/mock-outline.mjs.
 * TEST_DATABASE_URL must point to a disposable database: its schema is wiped before the run.
 */
const port = Number(process.env.MOCK_OUTLINE_PORT || 4100);

export default defineConfig({
  test: {
    include: ["test/functional/**/*.test.ts"],
    globalSetup: ["test/functional/global-setup.ts"],
    // One database for all files: run them one after the other.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL || "postgres://postgres:test@localhost:5432/taskspipes_test",
      APP_SECRET: "functional-test-secret-functional-test-secret",
      APP_URL: "http://tasks.test",
      OUTLINE_URL: `http://localhost:${port}`,
      OUTLINE_ALLOW_PRIVATE: "true",
      MOCK_OUTLINE_PORT: String(port),
      DEFAULT_LOCALE: "en",
      ADMIN_EMAILS: "alice@example.com, admin-by-mail@example.com",
      // The tests' webhook receiver listens on localhost.
      WEBHOOK_ALLOW_PRIVATE: "true",
      LOG_LEVEL: "silent",
      // Rate limits in Redis when the test stack provides one, else in memory.
      REDIS_URL: process.env.TEST_REDIS_URL || "",
    },
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/index.ts"],
      reporter: ["text-summary", "html", "lcov"],
      reportsDirectory: "coverage/functional",
    },
  },
});
