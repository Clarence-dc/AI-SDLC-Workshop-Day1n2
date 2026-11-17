import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { signSessionToken } from "../lib/auth";

test("authenticated subtask HTTP API scopes parents, validates writes and returns persisted checklists", { timeout: 60_000 }, async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "subtask-api-test-"));
  process.env.DATABASE_PATH = path.join(directory, "test.db");
  process.env.JWT_SECRET = randomBytes(32).toString("hex");
  const { closeDatabase, registerUser, todoDB, subtaskDB } = await import("../lib/db");
  const portServer = createServer();
  await new Promise<void>((resolve, reject) => {
    portServer.once("error", reject);
    portServer.listen(0, "127.0.0.1", resolve);
  });
  const address = portServer.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  await new Promise<void>((resolve, reject) =>
    portServer.close((error) => error ? reject(error) : resolve()));

  const owner = registerUser("subtask-http-owner", {
    credential_id: "subtask-http-owner-key", credential_public_key: Buffer.from([1]), counter: 0,
  });
  const other = registerUser("subtask-http-other", {
    credential_id: "subtask-http-other-key", credential_public_key: Buffer.from([2]), counter: 0,
  });
  const parent = todoDB.create(owner.id, { title: "Checklist parent" });
  const foreignParent = todoDB.create(other.id, { title: "Private parent" });
  const foreignSubtask = subtaskDB.create(foreignParent.id, other.id, { title: "Private child" })!;
  todoDB.update(parent.id, owner.id, { completed: true });
  const parentBefore = todoDB.findById(parent.id, owner.id)!;
  const cookie = `session=${await signSessionToken({ userId: owner.id, username: owner.username })}`;
  const otherCookie = `session=${await signSessionToken({ userId: other.id, username: other.username })}`;
  closeDatabase();

  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(address.port)], {
    env: { ...process.env, RP_ORIGIN: origin, RP_ID: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  const exited = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", () => resolve());
  });

  async function request(route: string, method = "GET", body?: string, sessionCookie = cookie, requestOrigin = origin) {
    return fetch(`${origin}${route}`, {
      method,
      headers: { Cookie: sessionCookie, Origin: requestOrigin, "Content-Type": "application/json" },
      body,
    });
  }

  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw new Error(`Test server exited: ${output}`);
      try {
        ready = (await request("/api/todos", "GET", undefined, "")).status === 401;
      } catch (error) {
        if (!(error instanceof TypeError && error.message === "fetch failed")) throw error;
      }
      if (ready) break;
      await delay(100);
    }
    assert.ok(ready, `Server was not ready: ${output}`);

    assert.equal((await request(`/api/todos/${parent.id}`)).headers.get("cache-control"), "no-store");
    const readParent = await (await request(`/api/todos/${parent.id}`)).json();
    assert.deepEqual(readParent.subtasks, []);
    assert.deepEqual(await (await request(`/api/todos/${parent.id}`, "GET", undefined, otherCookie)).json(),
      { error: "Todo not found" });
    for (const [route, method, body] of [
      [`/api/todos/${parent.id}/subtasks`, "POST", '{"title":"Unauthenticated"}'],
      [`/api/subtasks/${foreignSubtask.id}`, "PUT", '{"completed":true}'],
      [`/api/subtasks/${foreignSubtask.id}`, "DELETE", undefined],
    ] as const) {
      const response = await request(route, method, body, "");
      assert.equal(response.status, 401);
    }

    for (const body of ["null", "[]", "{}", '{"title":3}', '{"title":"  "}', '{"title":"Valid","extra":1}', "{"]) {
      const before = await (await request(`/api/todos/${parent.id}`)).json();
      const response = await request(`/api/todos/${parent.id}/subtasks`, "POST", body);
      assert.equal(response.status, 400, body);
      assert.deepEqual(await (await request(`/api/todos/${parent.id}`)).json(), before);
    }
    for (const requestOrigin of ["https://foreign.invalid", ""]) {
      assert.equal((await request(`/api/todos/${parent.id}/subtasks`, "POST", "{", cookie, requestOrigin)).status, 403);
    }
    assert.equal((await request(`/api/todos/${foreignParent.id}/subtasks`, "POST", '{"title":"Forbidden"}')).status, 404);
    assert.deepEqual(await (await request(`/api/todos/${foreignParent.id}`)).json(), { error: "Todo not found" });
    assert.deepEqual(await (await request("/api/todos/not-an-id/subtasks", "POST", '{"title":"Invalid id"}')).json(),
      { error: "Todo not found" });
    assert.equal((await request(`/api/subtasks/${foreignSubtask.id}`, "PUT", '{"completed":true}', cookie)).status, 404);
    assert.equal((await request(`/api/subtasks/${foreignSubtask.id}`, "DELETE", undefined, cookie)).status, 404);

    const latencies: number[] = [];
    async function timed(route: string, method: string, body?: string) {
      const start = performance.now();
      const response = await request(route, method, body);
      latencies.push(performance.now() - start);
      return response;
    }
    const firstResponse = await timed(`/api/todos/${parent.id}/subtasks`, "POST", '{"title":" First "}');
    assert.equal(firstResponse.status, 201);
    const first = await firstResponse.json();
    assert.equal(first.title, "First");
    assert.equal(first.position, 0);
    assert.equal(first.completed, false);
    const second = await (await timed(`/api/todos/${parent.id}/subtasks`, "POST", '{"title":"Second"}')).json();
    const third = await (await timed(`/api/todos/${parent.id}/subtasks`, "POST", '{"title":"Third"}')).json();
    assert.deepEqual([second.position, third.position], [1, 2]);

    const invalidUpdates = ["null", "[]", "{}", '{"title":"  "}', '{"completed":"yes"}',
      '{"title":"Changed","admin":true}', "{", '{"completed":true,"completed_at":"2000-01-01T00:00:00.000Z"}'];
    for (const body of invalidUpdates) {
      const before = await (await request(`/api/todos/${parent.id}`)).json();
      const response = await request(`/api/subtasks/${first.id}`, "PUT", body);
      assert.equal(response.status, 400, body);
      assert.deepEqual(await (await request(`/api/todos/${parent.id}`)).json(), before);
    }
    const toggled = await timed(`/api/subtasks/${first.id}`, "PUT", '{"completed":true}');
    assert.equal(toggled.status, 200);
    assert.deepEqual(await toggled.json(), { ...first, completed: true });
    const renamed = await (await timed(`/api/subtasks/${first.id}`, "PUT", '{"title":"Renamed"}')).json();
    assert.equal(renamed.title, "Renamed");
    assert.equal(renamed.completed, true);
    const beforeBlockedUpdate = await (await request(`/api/todos/${parent.id}`)).json();
    assert.equal((await request(`/api/subtasks/${first.id}`, "PUT", "{", cookie, "https://foreign.invalid")).status, 403);
    assert.deepEqual(await (await request(`/api/todos/${parent.id}`)).json(), beforeBlockedUpdate);
    assert.equal((await request(`/api/subtasks/${first.id}`, "DELETE", undefined, cookie, "")).status, 403);
    assert.ok((await (await request(`/api/todos/${parent.id}`)).json()).subtasks.some(
      (item: { id: number }) => item.id === first.id));

    let persistedParent = await (await request(`/api/todos/${parent.id}`)).json();
    assert.deepEqual(persistedParent.subtasks.map((item: { position: number }) => item.position), [0, 1, 2]);
    assert.equal(persistedParent.completed, true);
    assert.equal(persistedParent.completed_at, parentBefore.completed_at);
    assert.equal(persistedParent.updated_at, parentBefore.updated_at);

    assert.deepEqual(await (await timed(`/api/subtasks/${second.id}`, "DELETE")).json(), { success: true });
    const fourth = await (await timed(`/api/todos/${parent.id}/subtasks`, "POST", '{"title":"Fourth"}')).json();
    assert.equal(fourth.position, 3);
    persistedParent = await (await request(`/api/todos/${parent.id}`)).json();
    assert.deepEqual(persistedParent.subtasks.map((item: { position: number }) => item.position), [0, 2, 3]);
    assert.deepEqual((await request(`/api/subtasks/${second.id}`, "DELETE")).status, 404);

    const parentDelete = await request(`/api/todos/${parent.id}`, "DELETE");
    assert.equal(parentDelete.status, 200);
    assert.deepEqual(await (await request(`/api/todos/${parent.id}`)).json(), { error: "Todo not found" });
    const otherParentRead = await request(`/api/todos/${foreignParent.id}`, "GET", undefined, otherCookie);
    assert.deepEqual((await otherParentRead.json()).subtasks.map((item: { id: number }) => item.id), [foreignSubtask.id]);
    assert.ok(Math.max(...latencies) < 300, `Representative API CRUD requests took ${Math.max(...latencies).toFixed(2)} ms`);
    console.log(`Representative subtask API CRUD max: ${Math.max(...latencies).toFixed(2)} ms`);
  } finally {
    if (child.exitCode === null) child.kill();
    await exited;
    closeDatabase();
    const raw = await import("better-sqlite3");
    const db = new raw.default(process.env.DATABASE_PATH!);
    try {
      assert.equal((db.prepare("SELECT COUNT(*) AS count FROM subtasks WHERE todo_id = ?").get(parent.id) as { count: number }).count, 0);
      assert.equal((db.prepare("SELECT COUNT(*) AS count FROM subtasks WHERE todo_id NOT IN (SELECT id FROM todos)").get() as { count: number }).count, 0);
    } finally {
      db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }
});
