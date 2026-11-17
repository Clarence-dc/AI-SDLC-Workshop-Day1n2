import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

async function main(): Promise<void> {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "priority-playwright-"));
  const port = process.env.PRIORITY_E2E_PORT ?? "3189";
  const origin = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env,
    DATABASE_PATH: path.join(tempDir, "priority-test.db"),
    JWT_SECRET: randomBytes(32).toString("hex"),
    PRIORITY_E2E_TEMP_DIR: tempDir,
    PRIORITY_E2E_SESSION_FILE: path.join(tempDir, "session.json"),
    PRIORITY_E2E_PORT: port,
    RP_ORIGIN: origin,
    RP_ID: "127.0.0.1",
  };
  const cli = path.join(process.cwd(), "node_modules", "@playwright", "test", "cli.js");
  let child: ReturnType<typeof spawn> | undefined;

  try {
    const exitCode = await new Promise<number>((resolve, reject) => {
      child = spawn(
        process.execPath,
        [cli, "test", "--config=tests/e2e/playwright.config.ts"],
        { cwd: process.cwd(), env, stdio: "inherit" },
      );
      child.once("error", reject);
      child.once("exit", (code) => resolve(code ?? 1));
    });
    process.exitCode = exitCode;
  } finally {
    if (child?.exitCode === null) child.kill();
    rmSync(tempDir, { recursive: true, force: true });
  }
}

void main().catch((error: unknown) => {
  console.error("Could not run the priority Playwright suite.", error);
  process.exitCode = 1;
});
