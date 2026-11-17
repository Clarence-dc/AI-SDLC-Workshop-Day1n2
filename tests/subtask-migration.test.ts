import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import Database from "better-sqlite3";

const directory = mkdtempSync(path.join(os.tmpdir(), "subtask-migration-test-"));
process.env.DATABASE_PATH = path.join(directory, "legacy.db");
after(async () => {
  const { closeDatabase } = await import("../lib/db");
  closeDatabase();
  rmSync(directory, { recursive: true, force: true });
});

test("valid legacy subtask tables migrate with all rows and positions intact", async () => {
  let raw: Database.Database | undefined = new Database(process.env.DATABASE_PATH!);
  try {
    raw.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE todos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0, completed_at TEXT,
        due_date TEXT, priority TEXT NOT NULL DEFAULT 'medium', is_recurring INTEGER NOT NULL DEFAULT 0,
        recurrence_pattern TEXT, reminder_minutes INTEGER, last_notification_sent TEXT,
        created_at TEXT NOT NULL, updated_at TEXT
      );
      CREATE TABLE subtasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT, todo_id INTEGER NOT NULL,
        title TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0, position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      INSERT INTO users(id, username, created_at) VALUES (1, 'legacy', '2030-01-01T00:00:00.000Z');
      INSERT INTO todos(id, user_id, title, created_at)
        VALUES (10, 1, 'Existing parent', '2030-01-01T00:00:00.000Z');
      INSERT INTO subtasks(id, todo_id, title, completed, position, created_at) VALUES
        (20, 10, 'Keep me', 1, 4, '2030-01-01T01:00:00.000Z');
    `);
    raw.close();
    raw = undefined;
    const { closeDatabase, subtaskDB, todoDB } = await import("../lib/db");
    const migrated = subtaskDB.findByTodoId(10, 1);
    assert.deepEqual(migrated.map(({ id, todo_id, title, completed, position, created_at }) =>
      ({ id, todo_id, title, completed, position, created_at })), [{
      id: 20, todo_id: 10, title: "Keep me", completed: true, position: 4,
      created_at: "2030-01-01T01:00:00.000Z",
    }]);
    const migratedDb = new Database(process.env.DATABASE_PATH!);
    try {
      assert.deepEqual((migratedDb.pragma("foreign_key_list(subtasks)") as Array<{
        table: string; from: string; to: string; on_delete: string;
      }>).map(({ table, from, to, on_delete }) =>
        [table, from, to, on_delete.toUpperCase()]), [["todos", "todo_id", "id", "CASCADE"]]);
      assert.deepEqual(migratedDb.pragma("foreign_key_check"), []);
      assert.equal((migratedDb.prepare("SELECT COUNT(*) AS count FROM subtasks").get() as { count: number }).count, 1);
      assert.equal(subtaskDB.create(10, 1, { title: "Appended after migration" })?.position, 5);
      closeDatabase();
      assert.equal(todoDB.delete(10, 1), true);
      assert.equal((migratedDb.prepare("SELECT COUNT(*) AS count FROM subtasks").get() as { count: number }).count, 0);
    } finally {
      migratedDb.close();
    }
  } finally {
    raw?.close();
  }
});

test("orphaned or incompatible legacy rows abort migration without changing schema or data", async () => {
  const { closeDatabase, subtaskDB } = await import("../lib/db");
  const scenarios = [
    { name: "orphan", extraColumn: false, parentId: 999, expected: /1 row\(s\) reference missing todos/ },
    { name: "unsupported-column", extraColumn: true, parentId: 10, expected: /unsupported column\(s\) would not be preserved \(external_ref\)/ },
    { name: "unsupported-trigger", extraColumn: false, parentId: 10, expected: /custom index\/trigger\(s\) would not be preserved \(subtasks_custom_trigger\)/ },
  ];

  for (const scenario of scenarios) {
    closeDatabase();
    const databasePath = path.join(directory, `${scenario.name}.db`);
    process.env.DATABASE_PATH = databasePath;
    const raw = new Database(databasePath);
    raw.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE todos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0, completed_at TEXT,
        due_date TEXT, priority TEXT NOT NULL DEFAULT 'medium', is_recurring INTEGER NOT NULL DEFAULT 0,
        recurrence_pattern TEXT, reminder_minutes INTEGER, last_notification_sent TEXT,
        created_at TEXT NOT NULL, updated_at TEXT
      );
      INSERT INTO users(id, username, created_at) VALUES (1, 'legacy', '2030-01-01T00:00:00.000Z');
      INSERT INTO todos(id, user_id, title, created_at)
        VALUES (10, 1, 'Existing parent', '2030-01-01T00:00:00.000Z');
    `);
    const subtaskSchemaAndData = scenario.extraColumn
      ? `CREATE TABLE subtasks (
          id INTEGER PRIMARY KEY AUTOINCREMENT, todo_id INTEGER NOT NULL,
          title TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0, position INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL, external_ref TEXT NOT NULL
        );
        INSERT INTO subtasks(id, todo_id, title, position, created_at, external_ref)
          VALUES (20, 10, 'Keep this row', 4, '2030-01-01T01:00:00.000Z', 'opaque-reference');`
      : `CREATE TABLE subtasks (
          id INTEGER PRIMARY KEY AUTOINCREMENT, todo_id INTEGER NOT NULL,
          title TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0, position INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );
        INSERT INTO subtasks(id, todo_id, title, position, created_at)
          VALUES (20, ${scenario.parentId}, '${scenario.name === "orphan" ? "Keep orphan intact" : "Keep trigger row"}',
            4, '2030-01-01T01:00:00.000Z');`;
    raw.exec(subtaskSchemaAndData);
    if (scenario.name === "unsupported-trigger") {
      raw.exec(`
        CREATE TRIGGER subtasks_custom_trigger AFTER UPDATE ON subtasks BEGIN
          SELECT 1;
        END;
      `);
    }
    const originalSchema = raw.pragma("table_info(subtasks)");
    const originalForeignKeys = raw.pragma("foreign_key_list(subtasks)");
    const originalRowCount = (raw.prepare("SELECT COUNT(*) AS count FROM subtasks").get() as { count: number }).count;
    const originalSubtask = raw.prepare("SELECT * FROM subtasks WHERE id = 20").get();
    raw.close();

    assert.throws(() => subtaskDB.findByTodoId(10, 1), scenario.expected);

    const unchanged = new Database(databasePath);
    try {
      assert.deepEqual(unchanged.pragma("table_info(subtasks)"), originalSchema);
      assert.deepEqual(unchanged.pragma("foreign_key_list(subtasks)"), originalForeignKeys);
      assert.equal((unchanged.prepare("SELECT COUNT(*) AS count FROM subtasks").get() as { count: number }).count,
        originalRowCount);
      assert.deepEqual(unchanged.prepare("SELECT * FROM subtasks WHERE id = 20").get(), originalSubtask);
      assert.equal(unchanged.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'subtasks__migration'").get(),
        undefined);
      if (scenario.name === "unsupported-trigger") {
        assert.ok(unchanged.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'subtasks_custom_trigger'").get());
      }
    } finally {
      unchanged.close();
    }
  }
});
