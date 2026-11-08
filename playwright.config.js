import { defineConfig, devices } from "@playwright/test";
const url =
  process.env.GAME_URL || `http://127.0.0.1:${process.env.PORT || 4393}`;
// the phone we design for: an iPhone 13 in portrait (390x844, touch, 3x),
// driven by both engines
const phone = devices["iPhone 13"];
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.js",
  // slow frames on purpose (tests/fixtures.js) make every test take longer in wall time
  timeout: process.env.SLOW_FRAMES || process.env.THROTTLE ? 300000 : 60000,
  workers: 1,
  use: {
    baseURL: url,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...phone, browserName: "chromium" } },
    {
      name: "webkit",
      use: { ...phone, browserName: "webkit" },
      // Linux WebKit on CI can fail page.goto/page.reload with "WebKit
      // encountered an internal error" before any assertion runs (seen on the
      // house template). One retry on CI covers that class only; chromium keeps zero.
      retries: process.env.CI ? 1 : 0,
    },
  ],
  webServer: process.env.GAME_URL
    ? undefined
    : { command: "npm run preview", url, reuseExistingServer: false },
});
