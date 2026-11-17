import { test, after } from "node:test";
import assert from "node:assert/strict";
process.env.DATABASE_PATH = ":memory:";
const { db, userDB, todoDB, tagDB, subtaskDB, templateDB, challengeDB } =
  await import("../../lib/db");
const { addMinutes } = await import("../../lib/timezone");
const a = userDB.create("alice"),
  b = userDB.create("bob");
after(() => db.close());
test("ownership checks every linked object and cascade deletes", () => {
  const t = todoDB.create(a.id, { title: "Owned" }),
    tag = tagDB.create(a.id, { name: "Work", color: "#123456" }),
    s = subtaskDB.add(t.id, a.id, "Step");
  tagDB.attach(t.id, tag.id, a.id);
  assert.throws(() => todoDB.get(t.id, b.id), /Not found/);
  assert.throws(
    () => subtaskDB.update(s.id, b.id, { completed: true }),
    /Not found/,
  );
  assert.throws(() => tagDB.attach(t.id, tag.id, b.id), /Not found/);
  todoDB.delete(t.id, a.id);
  assert.equal(
    (
      db.prepare("SELECT count(*) AS n FROM subtasks WHERE id=?").get(s.id) as {
        n: number;
      }
    ).n,
    0,
  );
  assert.equal(
    (
      db
        .prepare("SELECT count(*) AS n FROM todo_tags WHERE todo_id=?")
        .get(t.id) as { n: number }
    ).n,
    0,
  );
});
test("recurring completion is idempotent even after reopening", () => {
  const t = todoDB.create(a.id, {
    title: "Repeat",
    due_date: addMinutes(120),
    is_recurring: true,
    recurrence_pattern: "monthly",
  });
  const before = todoDB.all(a.id).length;
  todoDB.update(t.id, a.id, { completed: true });
  todoDB.update(t.id, a.id, { completed: true });
  todoDB.update(t.id, a.id, { completed: false });
  todoDB.update(t.id, a.id, { completed: true });
  assert.equal(todoDB.all(a.id).length, before + 1);
});
test("subtask positions append and do not renumber", () => {
  const t = todoDB.create(a.id, { title: "Steps" });
  const s1 = subtaskDB.add(t.id, a.id, "One"),
    s2 = subtaskDB.add(t.id, a.id, "Two");
  subtaskDB.delete(s1.id, a.id);
  const s3 = subtaskDB.add(t.id, a.id, "Three");
  assert.equal(s2.position, 1);
  assert.equal(s3.position, 2);
});
test("import validates the whole payload, rolls back and reuses case-insensitive tags", () => {
  const existing = tagDB.create(b.id, { name: "Travel", color: "#000000" });
  const data = {
    version: 1,
    exported_at: addMinutes(0),
    todos: [
      {
        title: "Imported",
        completed: false,
        priority: "medium",
        due_date: null,
        is_recurring: false,
        recurrence_pattern: null,
        reminder_minutes: null,
        created_at: "2025-01-01T09:00:00+08:00",
        subtasks: [{ title: "Nested", position: 7, completed: true }],
        tags: [{ name: "TRAVEL", color: "#ffffff" }],
      },
    ],
  };
  assert.equal(todoDB.importAll(b.id, data), 1);
  const t = todoDB.all(b.id)[0];
  assert.equal(t.tags[0].id, existing.id);
  assert.equal(t.subtasks[0].todo_id, t.id);
  assert.equal(t.subtasks[0].completed, true);
  assert.equal(t.created_at, "2025-01-01T09:00:00+08:00");
  const before = todoDB.all(b.id).length;
  assert.throws(() =>
    todoDB.importAll(b.id, {
      ...data,
      todos: [data.todos[0], { title: "Invalid", is_recurring: true }],
    }),
  );
  assert.equal(todoDB.all(b.id).length, before);
  assert.throws(
    () =>
      todoDB.importAll(b.id, {
        ...data,
        todos: [{ title: "Missing required fields" }],
      }),
    /Failed to import/,
  );
  todoDB.importAll(b.id, data);
  assert.equal(todoDB.all(b.id).length, before + 1);
});
test("notification windows, claim once, changed date rearms", () => {
  const t = todoDB.create(b.id, {
    title: "Remind",
    due_date: addMinutes(5),
    reminder_minutes: 15,
  });
  assert.ok(todoDB.notifications(b.id).some((x) => x.id === t.id));
  assert.ok(!todoDB.notifications(b.id).some((x) => x.id === t.id));
  todoDB.update(t.id, b.id, { due_date: addMinutes(6) });
  assert.ok(todoDB.notifications(b.id).some((x) => x.id === t.id));
  const future = todoDB.create(b.id, {
    title: "Later",
    due_date: addMinutes(60),
    reminder_minutes: 15,
  });
  assert.ok(!todoDB.notifications(b.id).some((x) => x.id === future.id));
});
test("template recreates unchecked subtasks, relative date and excludes tags", () => {
  const t = templateDB.create(a.id, {
    name: "Routine",
    title_template: "New task",
    priority: "high",
    is_recurring: true,
    recurrence_pattern: "daily",
    due_date_offset_minutes: 120,
    subtasks_json: JSON.stringify([{ title: "Step", position: 4 }]),
  });
  const todo = templateDB.use(t.id, a.id);
  assert.equal(todo.subtasks[0].position, 4);
  assert.equal(todo.subtasks[0].completed, false);
  assert.equal(todo.tags.length, 0);
  assert.equal(todo.is_recurring, true);
  assert.throws(() => templateDB.use(t.id, b.id), /Not found/);
  templateDB.delete(t.id, a.id);
  assert.equal(todoDB.get(todo.id, a.id).title, "New task");
});
test("challenges are short-lived, isolated by kind, and single-use", () => {
  const id = challengeDB.create("challenge", "alice", "register");
  assert.equal(challengeDB.consume(id, "register")?.challenge, "challenge");
  assert.equal(challengeDB.consume(id, "register"), undefined);
});
