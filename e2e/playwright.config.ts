import { defineConfig } from "@playwright/test";

/**
 * Default baseURL is http://localhost:3002 — the local CRA dev server runs
 * on 3002 so it doesn't collide with the Rails API on 3000 (which the
 * frontend `proxy:` config points at).
 *
 * Override via E2E_BASE_URL when running against a deployed Render preview
 * (e.g. E2E_BASE_URL=https://voyara-n5q8.onrender.com npm test).
 */
export default defineConfig({
  testDir: ".",
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3002",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
