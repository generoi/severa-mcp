import { defineConfig } from "vitest/config";

// Integration / e2e configuration. Opt in via `npm run test:integration`.
// Hits the real Severa API using credentials from `.dev.vars` (or the
// environment), so it's excluded from the default `npm test` run.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/integration/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
