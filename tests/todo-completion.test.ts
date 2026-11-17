import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import Database from "better-sqlite3";

const directory = mkdtempSync(path.join(os.tmpdir(), "todo-completion-test-"));
process.env.DATABASE_PATH = path.join(directory, "test.db");
after(async () => {
  const { closeDatabase } = await import("../lib/db");
  closeDatabase();
  rmSync(directory, { recursive: true, force: true });
});

test("legacy migration backfills once without rewriting other data", async () => {
  const raw = new Database(process.env.DATABASE_PATH!);
  try {
    raw.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE TABLE todos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0,
        due_date TEXT, priority TEXT NOT NULL DEFAULT 'medium',
        is_recurring INTEGER NOT NULL DEFAULT 0, recurrence_pattern TEXT,
        reminder_minutes INTEGER, last_notification_sent TEXT,
        created_at TEXT NOT NULL, updated_at TEXT
      );
      INSERT INTO users(id, username) VALUES (1, 'legacy');
      INSERT INTO todos(id, user_id, title, completed, priority, created_at, updated_at)
      VALUES
        (1, 1, 'Legacy edited', 1, 'high', '2020-01-01T00:00:00.000Z', '2020-02-01T00:00:00.000Z'),
        (2, 1, 'Legacy unedited', 1, 'low', '2020-01-02T00:00:00.000Z', NULL),
        (3, 1, 'Still pending', 0, 'medium', '2020-01-03T00:00:00.000Z', '2020-02-03T00:00:00.000Z');
    `);
    const before = raw.prepare("SELECT * FROM todos ORDER BY id").all();
    const { closeDatabase, todoDB } = await import("../lib/db");
    const migrated = todoDB.findAllByUser(1).sort((a, b) => a.id - b.id);
    assert.deepEqual(migrated.map((todo) => todo.completed_at), [
      "2020-02-01T00:00:00.000Z", "2020-01-02T00:00:00.000Z", null,
    ]);
    assert.deepEqual(raw.prepare(`
      SELECT id, user_id, title, completed, due_date, priority, is_recurring,
        recurrence_pattern, reminder_minutes, last_notification_sent, created_at, updated_at
      FROM todos ORDER BY id
    `).all(), before);
    assert.deepEqual(todoDB.findAllByUser(2), []);
    const edited = todoDB.update(1, 1, { title: "Edited after migration", priority: "low" });
    assert.equal(edited?.completed_at, migrated[0].completed_at);
    assert.notEqual(edited?.updated_at, migrated[0].updated_at);
    closeDatabase();
    assert.deepEqual(todoDB.findById(1, 1), edited);
    assert.equal(todoDB.findById(2, 1)?.completed_at, migrated[1].completed_at);
    assert.equal(todoDB.findById(3, 1)?.completed_at, null);
  } finally {
    raw.close();
  }
});

test("completion timestamps track transitions only and remain server-owned", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2030, 0, 1) });
  const { closeDatabase, todoDB } = await import("../lib/db");
  const todo = todoDB.create(1, { title: "Complete me" });
  assert.equal(todo.completed_at, null);
  assert.throws(() => todoDB.update(todo.id, 1, { completed: true, tag_ids: [999999] }), /Tag not found/);
  assert.deepEqual(todoDB.findById(todo.id, 1), todo);
  const completed = todoDB.update(todo.id, 1, { completed: true });
  assert.equal(completed?.completed_at, "2030-01-01T00:00:00.000Z");
  assert.equal(completed?.updated_at, completed?.completed_at);
  context.mock.timers.tick(1000);
  const newer = todoDB.create(1, { title: "Completed later" });
  const newerCompleted = todoDB.update(newer.id, 1, { completed: true });
  const edited = todoDB.update(todo.id, 1, { title: "New title", priority: "high" });
  assert.equal(edited?.completed_at, completed?.completed_at);
  assert.equal(edited?.updated_at, "2030-01-01T00:00:01.000Z");
  context.mock.timers.tick(1000);
  assert.equal(todoDB.update(todo.id, 1, { completed: true })?.completed_at, completed?.completed_at);
  assert.equal(todoDB.update(todo.id, 2, { completed: false }), undefined);
  for (const completed_at of [null, "1999-01-01T00:00:00.000Z"]) {
    const before = todoDB.findById(todo.id, 1);
    assert.throws(() => todoDB.update(todo.id, 1, { completed: false, completed_at }), /Unsupported field/);
    assert.deepEqual(todoDB.findById(todo.id, 1), before);
    assert.throws(() => todoDB.create(1, { title: "Forged", completed_at }), /Unsupported field/);
  }
  closeDatabase();
  assert.equal(todoDB.findById(todo.id, 1)?.completed_at, completed?.completed_at);
  assert.equal(todoDB.findById(newer.id, 1)?.completed_at, newerCompleted?.completed_at);
  assert.ok(Date.parse(newerCompleted!.completed_at!) > Date.parse(todoDB.findById(todo.id, 1)!.completed_at!));
  assert.equal(todoDB.update(todo.id, 1, { completed: false })?.completed_at, null);
  context.mock.timers.tick(1000);
  assert.equal(todoDB.update(todo.id, 1, { completed: false })?.completed_at, null);
  assert.equal(todoDB.update(todo.id, 1, { completed: true })?.completed_at, "2030-01-01T00:00:03.000Z");
  closeDatabase();
  assert.equal(todoDB.findById(todo.id, 1)?.completed_at, "2030-01-01T00:00:03.000Z");
});
