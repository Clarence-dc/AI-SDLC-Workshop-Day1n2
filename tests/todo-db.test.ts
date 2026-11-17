import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import Database from "better-sqlite3";
import type { Todo } from "../lib/db";
import { validateTodoInput } from "../lib/todoValidation";

const directory = mkdtempSync(path.join(os.tmpdir(), "todo-db-test-"));
process.env.DATABASE_PATH = path.join(directory, "test.db");
after(async () => {
  const { closeDatabase } = await import("../lib/db");
  closeDatabase();
  rmSync(directory, { recursive: true, force: true });
});

test("CRUD preserves defaults, isolates ownership, persists and merges partial updates", async () => {
  const { todoDB, registerUser, closeDatabase } = await import("../lib/db");
  const user = registerUser("todo-owner", {
    credential_id: "todo-owner-key", credential_public_key: Buffer.from([1]), counter: 0,
  });
  const other = registerUser("other-owner", {
    credential_id: "other-key", credential_public_key: Buffer.from([2]), counter: 0,
  });
  const created = todoDB.create(user.id, { title: "  Persist this  " });
  assert.equal(created.title, "Persist this");
  assert.equal(created.priority, "medium");
  assert.equal(created.completed, false);
  assert.equal(created.completed_at, null);
  assert.equal(created.due_date, null);
  assert.deepEqual(created.subtasks, []);
  assert.deepEqual(created.tags, []);
  assert.equal(created.is_recurring, false);
  assert.equal(created.last_notification_sent, null);
  assert.equal(todoDB.findById(created.id, other.id), undefined);
  assert.deepEqual(todoDB.findAllByUser(other.id), []);
  assert.equal(todoDB.update(created.id, other.id, { title: "stolen" }), undefined);
  assert.equal(todoDB.delete(created.id, other.id), false);
  const updated = todoDB.update(created.id, user.id, { completed: true });
  assert.equal(updated?.title, created.title);
  assert.equal(updated?.completed, true);
  assert.ok(updated?.updated_at);
  assert.equal(updated.priority, created.priority);
  closeDatabase();
  assert.deepEqual(todoDB.findById(created.id, user.id), updated);
  assert.equal(todoDB.delete(created.id, user.id), true);
  assert.equal(todoDB.findById(created.id, user.id), undefined);
});

test("relation writes roll back, tags stay scoped and todo deletion cascades without deleting tags", async () => {
  const { todoDB, userDB } = await import("../lib/db");
  const user = userDB.findByUsername("todo-owner")!;
  const other = userDB.findByUsername("other-owner")!;
  const raw = new Database(process.env.DATABASE_PATH!);
  try {
    const tagId = Number(raw.prepare("INSERT INTO tags(user_id, name) VALUES (?, ?)").run(user.id, "Personal").lastInsertRowid);
    const foreignTag = Number(raw.prepare("INSERT INTO tags(user_id, name) VALUES (?, ?)").run(other.id, "Private").lastInsertRowid);
    const before = todoDB.findAllByUser(user.id).length;
    assert.throws(() => todoDB.create(user.id, { title: "No partial write", tag_ids: [foreignTag] }), /Tag not found/);
    assert.equal(todoDB.findAllByUser(user.id).length, before);
    const todo = todoDB.create(user.id, { title: "Related", tag_ids: [tagId, tagId] });
    assert.deepEqual(todo.tags?.map(({ id }) => id), [tagId]);
    assert.throws(() => todoDB.update(todo.id, user.id, { title: "rollback", tag_ids: [foreignTag] }), /Tag not found/);
    assert.equal(todoDB.findById(todo.id, user.id)?.title, "Related");
    raw.prepare("INSERT INTO subtasks(todo_id, title, position, completed) VALUES (?, ?, ?, ?)")
      .run(todo.id, "Child", 1, 1);
    assert.equal(todoDB.findAllByUser(user.id)[0].subtasks?.[0].completed, true);
    raw.prepare("UPDATE todos SET due_date = ?, reminder_minutes = 15, last_notification_sent = ? WHERE id = ?")
      .run("2020-01-01T00:00:00.000Z", "2019-12-31T23:45:00.000Z", todo.id);
    const overdue = todoDB.update(todo.id, user.id, { completed: true });
    assert.equal(overdue?.due_date, "2020-01-01T00:00:00.000Z");
    assert.equal(overdue?.last_notification_sent, "2019-12-31T23:45:00.000Z");
    assert.throws(() => todoDB.update(todo.id, user.id, { due_date: "2020-01-02T00:00:00Z" }));
    const rescheduled = todoDB.update(todo.id, user.id, { due_date: "2099-01-01T08:00:00+08:00" });
    assert.equal(rescheduled?.due_date, "2099-01-01T00:00:00.000Z");
    assert.equal(rescheduled?.last_notification_sent, null);
    assert.equal(rescheduled?.reminder_minutes, 15);
    const cleared = todoDB.update(todo.id, user.id, { due_date: null, reminder_minutes: null });
    assert.equal(cleared?.due_date, null);
    assert.equal(cleared?.reminder_minutes, null);
    assert.equal(todoDB.update(todo.id, user.id, { title: "Keep tags" })?.tags?.length, 1);
    assert.deepEqual(todoDB.update(todo.id, user.id, { tag_ids: [] })?.tags, []);
    todoDB.update(todo.id, user.id, { tag_ids: [tagId] });
    assert.equal(todoDB.delete(todo.id, user.id), true);
    assert.equal(raw.prepare("SELECT id FROM subtasks WHERE todo_id = ?").get(todo.id), undefined);
    assert.equal(raw.prepare("SELECT * FROM todo_tags WHERE todo_id = ?").get(todo.id), undefined);
    assert.ok(raw.prepare("SELECT id FROM tags WHERE id = ?").get(tagId));
  } finally {
    raw.close();
  }
});

test("due dates enforce the exact sixty-second boundary and reject impossible dates", () => {
  const now = Date.parse("2030-01-01T00:00:00.000Z");
  assert.equal(validateTodoInput({ title: "Exact", due_date: "2030-01-01T08:01:00+08:00" }, undefined, now).due_date,
    "2030-01-01T00:01:00.000Z");
  for (const date of ["2030-01-01T00:00:59.999Z", "2030-02-30T00:00:00Z", "2030-01-01T25:00:00Z", "2030-01-01T00:00:00", "bad"]) {
    assert.throws(() => validateTodoInput({ title: "Invalid", due_date: date }, undefined, now));
  }
  const existing: Todo = {
    id: 1, user_id: 1, title: "Overdue", completed: false,
    completed_at: null,
    due_date: "2020-01-01T00:00:00.000Z", priority: "medium", is_recurring: false,
    recurrence_pattern: null, reminder_minutes: null, last_notification_sent: null,
    created_at: "2019-01-01T00:00:00.000Z", updated_at: null,
  };
  assert.deepEqual(validateTodoInput({ completed: true }, existing, now), { completed: true });
  assert.equal(validateTodoInput({ due_date: "2020-01-01T08:00:00+08:00" }, existing, now).due_date, existing.due_date);
  assert.throws(() => validateTodoInput({ due_date: "2020-01-02T00:00:00Z" }, existing, now));
  assert.deepEqual(validateTodoInput({ due_date: null }, existing, now), { due_date: null });
});

test("validation rejects malformed bodies and prevents mass assignment", () => {
  for (const body of [null, [], "title", {}, { title: " " }, { title: 1 }, { title: "X", priority: null },
    { title: "X", priority: "urgent" }, { title: "X", user_id: 1 }, { title: "X", completed: true },
    { title: "X", is_recurring: "false" }, { title: "X", tag_ids: [1, "2"] },
    { title: "X", reminder_minutes: 42 }, { title: "X", is_recurring: true }]) {
    assert.throws(() => validateTodoInput(body));
  }
  assert.deepEqual(validateTodoInput({ title: " X ", tag_ids: [1, 1] }), { title: "X", tag_ids: [1] });
});
