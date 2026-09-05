import { defineConfig, devices } from "@playwright/test";

// End-to-end runs against the built export served by `serve`, not the dev server,
// so the suite exercises the same bytes the host will publish.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  // Bound browser contention so accessibility scans keep their test budget.
  workers: 2,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4001",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    {
      name: "firefox",
      use: {
        ...devices["Desktop Firefox"],
        launchOptions: {
          // Firefox's automation bridge can lose the execution context during a
          // COOP switch. Limit this workaround to the test browser; the server
          // keeps its production security headers.
          firefoxUserPrefs: { "browser.tabs.remote.useCrossOriginOpenerPolicy": false },
        },
      },
    },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: "npm run start",
    url: "http://127.0.0.1:4001",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
