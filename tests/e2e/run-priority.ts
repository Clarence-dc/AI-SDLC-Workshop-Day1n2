import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

async function main(): Promise<void> {
  const port = process.env.PRIORITY_E2E_PORT ?? "3189";
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error("PRIORITY_E2E_PORT must be a valid TCP port.");
  }
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "priority-playwright-"));
  const origin = `http://127.0.0.1:${port}`;
  const sessionFile = path.join(tempDir, "session.json");
  const databasePath = path.join(tempDir, "priority-test.db");
  const jwtSecret = randomBytes(32).toString("hex");
  const env = {
    ...process.env,
    DATABASE_PATH: databasePath,
    JWT_SECRET: jwtSecret,
    PRIORITY_E2E_TEMP_DIR: tempDir,
    PRIORITY_E2E_SESSION_FILE: sessionFile,
    PRIORITY_E2E_PORT: port,
    RP_ORIGIN: origin,
    RP_ID: "127.0.0.1",
  };

  try {
    Object.assign(process.env, {
      DATABASE_PATH: databasePath,
      JWT_SECRET: jwtSecret,
      RP_ORIGIN: origin,
      RP_ID: "127.0.0.1",
    });
    const { closeDatabase, registerUser } = await import("../../lib/db");
    const { signSessionToken } = await import("../../lib/auth");
    const user = registerUser(`priority-e2e-${randomBytes(8).toString("hex")}`, {
      credential_id: `priority-e2e-key-${randomBytes(8).toString("hex")}`,
      credential_public_key: Buffer.from([1]),
      counter: 0,
    });
    const token = await signSessionToken({ userId: user.id, username: user.username });
    writeFileSync(sessionFile, JSON.stringify({ origin, token }), { mode: 0o600 });
    closeDatabase();

    const cli = path.join(process.cwd(), "node_modules", "@playwright", "test", "cli.js");
    const exitCode = await new Promise<number>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [cli, "test", "--config=tests/e2e/playwright.config.ts"],
        { cwd: process.cwd(), env, stdio: "inherit" },
      );
      child.once("error", reject);
      child.once("exit", (code) => resolve(code ?? 1));
    });
    process.exitCode = exitCode;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

void main().catch((error: unknown) => {
  console.error("Could not run the priority Playwright suite.", error);
  process.exitCode = 1;
});
