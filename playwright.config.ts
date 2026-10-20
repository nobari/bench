import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  workers: 2,
  reporter: "list",
  use: { baseURL: "http://localhost:3011", channel: "chrome", headless: true },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
  webServer: {
    command: "pnpm start --port 3011",
    url: "http://localhost:3011",
    reuseExistingServer: false,
  },
});
