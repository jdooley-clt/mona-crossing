import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/browser",
  timeout: 120000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: process.env.GAME_URL || "http://127.0.0.1:4177/mona-crossing/",
    browserName: "chromium",
    channel: process.env.CI ? undefined : "chrome",
    viewport: { width: 1280, height: 1000 },
    trace: "on-first-retry"
  },
  webServer: process.env.GAME_URL ? undefined : {
    command: "npm start", url: "http://127.0.0.1:4177/mona-crossing/", reuseExistingServer: !process.env.CI
  }
});
