import path from "node:path";
import { defineConfig } from "@playwright/test";

const tempDir = process.env.PRIORITY_E2E_TEMP_DIR;
const sessionFile = process.env.PRIORITY_E2E_SESSION_FILE;
const databasePath = process.env.DATABASE_PATH;
const jwtSecret = process.env.JWT_SECRET;
const port = process.env.PRIORITY_E2E_PORT ?? "3189";
const origin = `http://127.0.0.1:${port}`;
if (!tempDir || !sessionFile || !databasePath || !jwtSecret) {
  throw new Error("Run the priority Playwright suite with npm run test:e2e:priority.");
}

export default defineConfig({
  testDir: "..",
  testMatch: ["03-priority.spec.ts", "07-subtasks.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: "list",
  outputDir: path.join(process.cwd(), "test-results", "priority-e2e"),
  metadata: {
    priorityE2eTempDir: tempDir,
    priorityE2eSessionFile: sessionFile,
  },
  use: {
    baseURL: origin,
    browserName: "chromium",
    colorScheme: "light",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {},
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `node node_modules/next/dist/bin/next start -H 127.0.0.1 -p ${port}`,
    cwd: process.cwd(),
    url: `${origin}/login`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      ...process.env,
      DATABASE_PATH: databasePath,
      JWT_SECRET: jwtSecret,
      PRIORITY_E2E_TEMP_DIR: tempDir,
      PRIORITY_E2E_SESSION_FILE: sessionFile,
      PRIORITY_E2E_PORT: port,
      RP_ORIGIN: origin,
      RP_ID: "127.0.0.1",
    },
  },
});
