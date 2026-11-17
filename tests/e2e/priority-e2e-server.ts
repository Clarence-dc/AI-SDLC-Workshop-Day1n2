import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { closeDatabase, registerUser } from "../../lib/db";
import { signSessionToken } from "../../lib/auth";

async function main(): Promise<void> {
  const tempDir = process.env.PRIORITY_E2E_TEMP_DIR;
  const sessionFile = process.env.PRIORITY_E2E_SESSION_FILE;
  const port = Number(process.env.PRIORITY_E2E_PORT ?? "3189");
  if (!tempDir || !sessionFile || !process.env.JWT_SECRET || !process.env.RP_ORIGIN) {
    throw new Error("Playwright test server environment is incomplete.");
  }

  const databasePath = process.env.DATABASE_PATH ?? path.join(tempDir, "priority-test.db");
  process.env.DATABASE_PATH = databasePath;
  const user = registerUser(`priority-e2e-${randomBytes(8).toString("hex")}`, {
    credential_id: `priority-e2e-key-${randomBytes(8).toString("hex")}`,
    credential_public_key: Buffer.from([1]),
    counter: 0,
  });
  const token = await signSessionToken({ userId: user.id, username: user.username });
  writeFileSync(sessionFile, JSON.stringify({ origin: process.env.RP_ORIGIN, token }), { mode: 0o600 });
  closeDatabase();

  const server = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)],
    { cwd: process.cwd(), env: process.env, stdio: "inherit" },
  );
  const exited = new Promise<number | null>((resolve, reject) => {
    server.once("error", reject);
    server.once("exit", resolve);
  });
  const stop = (): void => {
    if (server.exitCode === null) server.kill();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  const exitCode = await exited;
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
  if (exitCode !== 0) {
    throw new Error(`Next.js test server exited with code ${exitCode}.`);
  }
}

void main().catch((error: unknown) => {
  console.error("Could not start the Playwright test server.", error);
  closeDatabase();
  const tempDir = process.env.PRIORITY_E2E_TEMP_DIR;
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  process.exitCode = 1;
});
