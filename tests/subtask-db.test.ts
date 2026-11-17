import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const directory = mkdtempSync(path.join(os.tmpdir(), "subtask-db-test-"));
process.env.DATABASE_PATH = path.join(directory, "test.db");
after(async () => {
  const { closeDatabase } = await import("../lib/db");
  closeDatabase();
  rmSync(directory, { recursive: true, force: true });
});

test("subtasks append by position, preserve gaps, persist, and never complete the parent", async () => {
  const { closeDatabase, registerUser, subtaskDB, todoDB } = await import("../lib/db");
  const user = registerUser("subtask-owner", {
    credential_id: "subtask-owner-key", credential_public_key: Buffer.from([1]), counter: 0,
  });
  const other = registerUser("subtask-other", {
    credential_id: "subtask-other-key", credential_public_key: Buffer.from([2]), counter: 0,
  });
  const todo = todoDB.create(user.id, { title: "Independent parent" });
  const first = subtaskDB.create(todo.id, user.id, { title: "  First  " })!;
  const second = subtaskDB.create(todo.id, user.id, { title: "Second" })!;
  const third = subtaskDB.create(todo.id, user.id, { title: "Third" })!;
  assert.equal(first.position, 0);
  assert.equal(first.title, "First");
  assert.equal(second.position, 1);
  assert.equal(third.position, 2);
  assert.equal(subtaskDB.delete(second.id, user.id), true);
  const fourth = subtaskDB.create(todo.id, user.id, { title: "Fourth" })!;
  assert.equal(fourth.position, 3);
  assert.deepEqual(subtaskDB.findByTodoId(todo.id, user.id).map(({ id, position }) => ({ id, position })), [
    { id: first.id, position: 0 }, { id: third.id, position: 2 }, { id: fourth.id, position: 3 },
  ]);
  assert.deepEqual(subtaskDB.findByTodoId(todo.id, other.id), []);
  assert.equal(subtaskDB.findById(first.id, other.id), undefined);
  assert.equal(subtaskDB.update(first.id, other.id, { completed: true }), undefined);
  assert.equal(subtaskDB.delete(first.id, other.id), false);

  const completedParent = todoDB.update(todo.id, user.id, { completed: true })!;
  const completionTime = completedParent.completed_at;
  const renamed = subtaskDB.update(first.id, user.id, { title: "Renamed", completed: true })!;
  assert.equal(renamed.title, "Renamed");
  assert.equal(renamed.completed, true);
  assert.deepEqual(subtaskDB.findById(first.id, user.id), renamed);
  assert.equal(todoDB.findById(todo.id, user.id)?.completed, true);
  assert.equal(todoDB.findById(todo.id, user.id)?.completed_at, completionTime);

  closeDatabase();
  assert.deepEqual(subtaskDB.findByTodoId(todo.id, user.id).map(({ position }) => position), [0, 2, 3]);
  assert.equal(todoDB.delete(todo.id, user.id), true);
  assert.deepEqual(subtaskDB.findByTodoId(todo.id, user.id), []);
  assert.equal(subtaskDB.findById(third.id, user.id), undefined);
});

test("subtask parent completion does not complete checklist rows", async () => {
  const { registerUser, subtaskDB, todoDB } = await import("../lib/db");
  const user = registerUser("independent-state", {
    credential_id: "independent-state-key", credential_public_key: Buffer.from([3]), counter: 0,
  });
  const todo = todoDB.create(user.id, { title: "Parent" });
  const child = subtaskDB.create(todo.id, user.id, { title: "Child" })!;
  todoDB.update(todo.id, user.id, { completed: true });
  assert.equal(todoDB.findById(todo.id, user.id)?.completed_at !== null, true);
  assert.equal(subtaskDB.findById(child.id, user.id)?.completed, false);
});
