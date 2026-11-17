import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testIgnore: "unit/**",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45000,
  expect: { timeout: 10000 },
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://localhost:3000",
    timezoneId: "Asia/Singapore",
    trace: "retain-on-failure",
    launchOptions: { args: ["--enable-web-authentication-testing-api"] },
  },
  webServer: {
    command: "npm run seed:holidays && npm run dev",
    env: { DATABASE_PATH: ".e2e-todos.db" },
    url: "http://localhost:3000/login",
    reuseExistingServer: false,
    timeout: 120000,
  },
});
