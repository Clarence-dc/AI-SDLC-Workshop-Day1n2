import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { SignJWT } from "jose";
import { setTimeout as delay } from "node:timers/promises";
import { signSessionToken } from "../lib/auth";

test("authenticated todo HTTP contract, validation and ownership", { timeout: 60_000 }, async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "todo-api-test-"));
  process.env.DATABASE_PATH = path.join(directory, "test.db");
  process.env.JWT_SECRET = randomBytes(32).toString("hex");
  const { closeDatabase, registerUser } = await import("../lib/db");
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  const owner = registerUser("http-owner", {
    credential_id: "http-owner-key", credential_public_key: Buffer.from([1]), counter: 0,
  });
  const other = registerUser("http-other", {
    credential_id: "http-other-key", credential_public_key: Buffer.from([2]), counter: 0,
  });
  const cookie = `session=${await signSessionToken({ userId: owner.id, username: owner.username })}`;
  const otherCookie = `session=${await signSessionToken({ userId: other.id, username: other.username })}`;
  const expired = await new SignJWT({ userId: owner.id, username: owner.username })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt(1).setExpirationTime(2)
    .sign(new TextEncoder().encode(process.env.JWT_SECRET));
  const invalidCookies = [
    `${cookie}tampered`,
    `session=${expired}`,
    `session=${await signSessionToken({ userId: 999999, username: "missing-user" })}`,
  ];
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
      method, headers: { Cookie: sessionCookie, Origin: requestOrigin, "Content-Type": "application/json" }, body,
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
    for (const [route, method] of [["/api/todos", "POST"], ["/api/todos/1", "GET"], ["/api/todos/1", "PUT"], ["/api/todos/1", "DELETE"]]) {
      assert.equal((await request(route, method, undefined, "")).status, 401);
    }
    assert.deepEqual(await (await request("/api/todos")).json(), []);
    for (const invalidCookie of invalidCookies) {
      for (const [route, method] of [
        ["/api/todos", "GET"], ["/api/todos", "POST"],
        ["/api/todos/1", "GET"], ["/api/todos/1", "PUT"], ["/api/todos/1", "DELETE"],
      ]) {
        const denied = await request(route, method, undefined, invalidCookie);
        assert.equal(denied.status, 401);
        assert.deepEqual(await denied.json(), { error: "Not authenticated" });
      }
    }
    assert.equal((await request("/api/todos", "POST", '{"title":"X"}', cookie, "https://foreign.invalid")).status, 403);
    assert.equal((await request("/api/todos", "POST", "{")).status, 400);
    assert.equal((await request("/api/todos", "POST", '{"title":3}')).status, 400);
    assert.equal((await request("/api/todos", "POST", '{"title":"X","user_id":999}')).status, 400);
    for (const priority of [undefined, "high", "medium", "low"]) {
      const created = await request("/api/todos", "POST", JSON.stringify({ title: "Priority contract", priority }));
      assert.equal(created.status, 201);
      const createdTodo = await created.json();
      assert.equal(createdTodo.priority, priority ?? "medium");
      for (const nextPriority of ["low", "high", "medium"]) {
        const changed = await request(`/api/todos/${createdTodo.id}`, "PUT", JSON.stringify({ priority: nextPriority }));
        assert.equal(changed.status, 200);
        assert.equal((await changed.json()).todo.priority, nextPriority);
        assert.equal((await (await request(`/api/todos/${createdTodo.id}`)).json()).priority, nextPriority);
      }
      assert.equal((await request(`/api/todos/${createdTodo.id}`, "DELETE")).status, 200);
    }
    const response = await request("/api/todos", "POST", '{"title":"  Created by HTTP  ","priority":"high"}');
    assert.equal(response.status, 201);
    const todo = await response.json();
    assert.equal(todo.title, "Created by HTTP");
    assert.equal(todo.user_id, owner.id);
    assert.equal(todo.completed, false);
    assert.equal(todo.priority, "high");
    assert.deepEqual(todo.tags, []);
    assert.deepEqual(todo.subtasks, []);
    for (const requestOrigin of ["https://foreign.invalid", ""]) {
      for (const [route, method] of [
        ["/api/todos", "POST"], [`/api/todos/${todo.id}`, "PUT"],
        [`/api/todos/${todo.id}`, "DELETE"],
      ]) {
        assert.equal((await request(route, method, undefined, cookie, requestOrigin)).status, 403);
      }
    }
    assert.deepEqual(await (await request(`/api/todos/${todo.id}`)).json(), todo);
    assert.equal((await request("/api/todos")).headers.get("cache-control"), "no-store");
    assert.equal((await (await request("/api/todos")).json()).length, 1);
    assert.deepEqual(await (await request(`/api/todos/${todo.id}`)).json(), todo);
    for (const method of ["GET", "PUT", "DELETE"]) {
      assert.equal((await request(`/api/todos/${todo.id}`, method, method === "PUT" ? '{"title":"stolen"}' : undefined, otherCookie)).status, 404);
    }
    assert.deepEqual(await (await request("/api/todos", "GET", undefined, otherCookie)).json(), []);
    assert.equal((await request("/api/todos/1junk")).status, 404);
    for (const priority of [null, "urgent", "HIGH", "", 0, true, [], {}]) {
      const before = await (await request("/api/todos")).json();
      const rejectedCreate = await request("/api/todos", "POST", JSON.stringify({ title: "Rejected", priority }));
      assert.equal(rejectedCreate.status, 400);
      assert.match((await rejectedCreate.json()).error, /priority/i);
      assert.deepEqual(await (await request("/api/todos")).json(), before);
      const rejectedUpdate = await request(`/api/todos/${todo.id}`, "PUT", JSON.stringify({ title: "Must not change", priority }));
      assert.equal(rejectedUpdate.status, 400);
      assert.match((await rejectedUpdate.json()).error, /priority/i);
      assert.deepEqual(await (await request("/api/todos")).json(), before);
    }
    const updated = await (await request(`/api/todos/${todo.id}`, "PUT", '{"completed":true}')).json();
    assert.equal(updated.todo.completed, true);
    assert.equal(updated.todo.title, todo.title);
    assert.equal(updated.todo.priority, "high");
    assert.ok(updated.todo.updated_at);
    assert.deepEqual(await (await request(`/api/todos/${todo.id}`, "DELETE")).json(), { success: true });
    assert.equal((await request(`/api/todos/${todo.id}`)).status, 404);
    assert.deepEqual(await (await request("/api/todos")).json(), []);
  } finally {
    if (child.exitCode === null) child.kill();
    await exited;
    closeDatabase();
    rmSync(directory, { recursive: true, force: true });
  }
});
