import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import {
  addMinutes,
  calculateNextDueDate,
  getSingaporeNow,
  parseSingaporeDate,
  singaporeISO,
} from "./timezone";
import {
  importSchema,
  parseTemplateSubtasks,
  templateSchema,
  validateTodo,
  type TodoInput,
} from "./validation";
export type Priority = "high" | "medium" | "low";
export type RecurrencePattern = "daily" | "weekly" | "monthly" | "yearly";
export type ReminderMinutes = 15 | 30 | 60 | 120 | 1440 | 2880 | 10080;
export interface User {
  id: number;
  username: string;
  created_at: string;
}
export interface Authenticator {
  id: number;
  user_id: number;
  credential_id: string;
  credential_public_key: Buffer;
  counter: number;
  created_at: string;
}
export interface Session {
  userId: number;
  username: string;
}
export interface Subtask {
  id: number;
  todo_id: number;
  title: string;
  completed: boolean;
  position: number;
  created_at: string;
}
export interface Tag {
  id: number;
  user_id: number;
  name: string;
  color: string;
  created_at: string;
}
export interface Todo extends TodoInput {
  id: number;
  user_id: number;
  last_notification_sent: string | null;
  created_at: string;
  updated_at: string | null;
  subtasks: Subtask[];
  tags: Tag[];
}
export interface Template {
  id: number;
  user_id: number;
  name: string;
  description: string | null;
  category: string | null;
  title_template: string;
  priority: Priority;
  is_recurring: boolean;
  recurrence_pattern: RecurrencePattern | null;
  reminder_minutes: number | null;
  due_date_offset_minutes: number | null;
  subtasks_json: string | null;
  created_at: string;
}
export interface Holiday {
  id: number;
  date: string;
  name: string;
}
const globalDB = globalThis as unknown as { todoDatabase?: Database.Database };
export const db =
  globalDB.todoDatabase ??
  new Database(process.env.DATABASE_PATH || "todos.db");
if (process.env.NODE_ENV !== "production") globalDB.todoDatabase = db;
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE COLLATE NOCASE, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS authenticators(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,credential_id TEXT NOT NULL UNIQUE,credential_public_key BLOB NOT NULL,counter INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS todos(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,title TEXT NOT NULL,completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0,1)),due_date TEXT,priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('high','medium','low')),is_recurring INTEGER NOT NULL DEFAULT 0,recurrence_pattern TEXT,reminder_minutes INTEGER,last_notification_sent TEXT,created_at TEXT NOT NULL,updated_at TEXT);
CREATE TABLE IF NOT EXISTS subtasks(id INTEGER PRIMARY KEY AUTOINCREMENT,todo_id INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,title TEXT NOT NULL,completed INTEGER NOT NULL DEFAULT 0,position INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tags(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,name TEXT NOT NULL COLLATE NOCASE,color TEXT NOT NULL DEFAULT '#3B82F6',created_at TEXT NOT NULL,UNIQUE(user_id,name));
CREATE TABLE IF NOT EXISTS todo_tags(todo_id INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,PRIMARY KEY(todo_id,tag_id));
CREATE TABLE IF NOT EXISTS templates(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,name TEXT NOT NULL,description TEXT,category TEXT,title_template TEXT NOT NULL,priority TEXT NOT NULL DEFAULT 'medium',is_recurring INTEGER NOT NULL DEFAULT 0,recurrence_pattern TEXT,reminder_minutes INTEGER,due_date_offset_minutes INTEGER,subtasks_json TEXT,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS holidays(id INTEGER PRIMARY KEY AUTOINCREMENT,date TEXT NOT NULL UNIQUE,name TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_todos_user_id ON todos(user_id);
CREATE INDEX IF NOT EXISTS idx_todos_due_date ON todos(due_date);
CREATE INDEX IF NOT EXISTS idx_subtasks_todo_id ON subtasks(todo_id);
CREATE INDEX IF NOT EXISTS idx_authenticators_user_id ON authenticators(user_id);
CREATE TABLE IF NOT EXISTS auth_challenges(id TEXT PRIMARY KEY,challenge TEXT NOT NULL,username TEXT NOT NULL,kind TEXT NOT NULL,user_id INTEGER,expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS recurrence_instances(source_id INTEGER PRIMARY KEY REFERENCES todos(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS rate_limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires_at INTEGER NOT NULL);
`);
function notFound(): never {
  throw new Error("Not found");
}
export const userDB = {
  byName: (username: string) =>
    db.prepare("SELECT * FROM users WHERE username=?").get(username) as
      User | undefined,
  byId: (id: number) =>
    db.prepare("SELECT * FROM users WHERE id=?").get(id) as User | undefined,
  create: (username: string) => {
    const r = db
      .prepare("INSERT INTO users(username,created_at) VALUES (?,?)")
      .run(username, singaporeISO());
    return userDB.byId(Number(r.lastInsertRowid))!;
  },
  authenticators: (userId: number) =>
    db
      .prepare("SELECT * FROM authenticators WHERE user_id=?")
      .all(userId) as Authenticator[],
  credential: (id: string) =>
    db.prepare("SELECT * FROM authenticators WHERE credential_id=?").get(id) as
      Authenticator | undefined,
  addCredential: (
    userId: number,
    id: string,
    key: Uint8Array,
    counter: number,
  ) =>
    db
      .prepare(
        "INSERT INTO authenticators(user_id,credential_id,credential_public_key,counter,created_at) VALUES (?,?,?,?,?)",
      )
      .run(userId, id, Buffer.from(key), counter ?? 0, singaporeISO()),
};
export const challengeDB = {
  create: (
    challenge: string,
    username: string,
    kind: string,
    userId?: number,
  ) => {
    const id = randomUUID();
    db.prepare("DELETE FROM auth_challenges WHERE expires_at < ?").run(
      Date.now(),
    );
    db.prepare("INSERT INTO auth_challenges VALUES (?,?,?,?,?,?)").run(
      id,
      challenge,
      username,
      kind,
      userId ?? null,
      Date.now() + 300000,
    );
    return id;
  },
  consume: db.transaction((id: string, kind: string) => {
    const row = db
      .prepare(
        "SELECT * FROM auth_challenges WHERE id=? AND kind=? AND expires_at>?",
      )
      .get(id, kind, Date.now()) as
      | { challenge: string; username: string; user_id: number | null }
      | undefined;
    db.prepare("DELETE FROM auth_challenges WHERE id=?").run(id);
    return row;
  }),
};
export function allowRequest(key: string, limit: number) {
  return db.transaction(() => {
    const now = Date.now();
    db.prepare("DELETE FROM rate_limits WHERE expires_at<?").run(now);
    db.prepare(
      "INSERT INTO rate_limits VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1",
    ).run(key, now + 60000);
    return (
      (
        db.prepare("SELECT count FROM rate_limits WHERE key=?").get(key) as {
          count: number;
        }
      ).count <= limit
    );
  })();
}
function hydrate(row: Todo): Todo {
  return {
    ...row,
    completed: !!row.completed,
    is_recurring: !!row.is_recurring,
    subtasks: (
      db
        .prepare("SELECT * FROM subtasks WHERE todo_id=? ORDER BY position,id")
        .all(row.id) as Subtask[]
    ).map((s) => ({ ...s, completed: !!s.completed })),
    tags: db
      .prepare(
        "SELECT tags.* FROM tags JOIN todo_tags ON tags.id=todo_tags.tag_id WHERE todo_tags.todo_id=? ORDER BY tags.name",
      )
      .all(row.id) as Tag[],
  };
}
function insertTodo(userId: number, data: TodoInput) {
  const r = db
    .prepare(
      "INSERT INTO todos(user_id,title,completed,due_date,priority,is_recurring,recurrence_pattern,reminder_minutes,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
    )
    .run(
      userId,
      data.title,
      +data.completed,
      data.due_date,
      data.priority,
      +data.is_recurring,
      data.recurrence_pattern,
      data.reminder_minutes,
      singaporeISO(),
    );
  return Number(r.lastInsertRowid);
}
export const todoDB = {
  all: (userId: number) =>
    (
      db
        .prepare("SELECT * FROM todos WHERE user_id=? ORDER BY id DESC")
        .all(userId) as Todo[]
    ).map(hydrate),
  get: (id: number, userId: number) => {
    const r = db
      .prepare("SELECT * FROM todos WHERE id=? AND user_id=?")
      .get(id, userId) as Todo | undefined;
    return r ? hydrate(r) : notFound();
  },
  create: (userId: number, value: unknown) =>
    todoDB.get(insertTodo(userId, validateTodo(value)), userId),
  update: db.transaction(
    (id: number, userId: number, value: Record<string, unknown>) => {
      const current = todoDB.get(id, userId);
      const changedDate =
        Object.hasOwn(value, "due_date") && value.due_date !== current.due_date;
      const data = validateTodo({ ...current, ...value }, changedDate);
      const reset =
        data.due_date !== current.due_date ||
        data.reminder_minutes !== current.reminder_minutes;
      db.prepare(
        "UPDATE todos SET title=?,completed=?,due_date=?,priority=?,is_recurring=?,recurrence_pattern=?,reminder_minutes=?,last_notification_sent=?,updated_at=? WHERE id=? AND user_id=?",
      ).run(
        data.title,
        +data.completed,
        data.due_date,
        data.priority,
        +data.is_recurring,
        data.recurrence_pattern,
        data.reminder_minutes,
        reset ? null : current.last_notification_sent,
        singaporeISO(),
        id,
        userId,
      );
      if (
        !current.completed &&
        data.completed &&
        data.is_recurring &&
        data.due_date &&
        data.recurrence_pattern
      ) {
        const claim = db
          .prepare(
            "INSERT OR IGNORE INTO recurrence_instances(source_id) VALUES (?)",
          )
          .run(id);
        if (claim.changes) {
          const nextId = insertTodo(userId, {
            ...data,
            completed: false,
            due_date: calculateNextDueDate(
              data.due_date,
              data.recurrence_pattern,
            ),
          });
          for (const tag of current.tags)
            db.prepare("INSERT INTO todo_tags VALUES (?,?)").run(
              nextId,
              tag.id,
            );
          for (const s of current.subtasks)
            subtaskDB.add(nextId, userId, s.title, s.position);
        }
      }
      return todoDB.get(id, userId);
    },
  ),
  delete: (id: number, userId: number) => {
    todoDB.get(id, userId);
    db.prepare("DELETE FROM todos WHERE id=? AND user_id=?").run(id, userId);
  },
  exportAll: (userId: number) => ({
    version: 1,
    exported_at: singaporeISO(),
    todos: todoDB.all(userId).map((t) => ({
      title: t.title,
      completed: t.completed,
      due_date: t.due_date,
      priority: t.priority,
      is_recurring: t.is_recurring,
      recurrence_pattern: t.recurrence_pattern,
      reminder_minutes: t.reminder_minutes,
      created_at: t.created_at,
      subtasks: t.subtasks.map((s) => ({
        title: s.title,
        completed: s.completed,
        position: s.position,
      })),
      tags: t.tags.map((tag) => ({ name: tag.name, color: tag.color })),
    })),
  }),
  importAll: db.transaction((userId: number, value: unknown) => {
    const parsed = importSchema.safeParse(value);
    if (!parsed.success)
      throw new Error("Failed to import todos. Please check the file format.");
    // Validate every cross-field invariant before the first insert, allowing historic due dates.
    const items = parsed.data.todos.map((t) => ({
      ...t,
      ...validateTodo(t, false),
    }));
    for (const t of items) {
      const id = insertTodo(userId, t);
      db.prepare("UPDATE todos SET created_at=? WHERE id=? AND user_id=?").run(
        t.created_at,
        id,
        userId,
      );
      for (const s of t.subtasks) {
        const sub = subtaskDB.add(id, userId, s.title, s.position);
        db.prepare("UPDATE subtasks SET completed=? WHERE id=?").run(
          +s.completed,
          sub.id,
        );
      }
      for (const tag of t.tags) {
        let existing = db
          .prepare(
            "SELECT * FROM tags WHERE user_id=? AND name=? COLLATE NOCASE",
          )
          .get(userId, tag.name) as Tag | undefined;
        existing ??= tagDB.create(userId, tag);
        tagDB.attach(id, existing.id, userId);
      }
    }
    return items.length;
  }),
  notifications: db.transaction((userId: number) => {
    const now = getSingaporeNow().getTime();
    const result = todoDB
      .all(userId)
      .filter(
        (t) =>
          !t.completed &&
          t.due_date &&
          t.reminder_minutes &&
          !t.last_notification_sent &&
          now >=
            parseSingaporeDate(t.due_date).getTime() -
              t.reminder_minutes * 60000 &&
          now <= parseSingaporeDate(t.due_date).getTime(),
      );
    for (const t of result)
      db.prepare(
        "UPDATE todos SET last_notification_sent=? WHERE id=? AND user_id=? AND last_notification_sent IS NULL",
      ).run(singaporeISO(), t.id, userId);
    return result;
  }),
};
export const subtaskDB = {
  get: (id: number, userId: number) => {
    const s = db
      .prepare(
        "SELECT s.* FROM subtasks s JOIN todos t ON t.id=s.todo_id WHERE s.id=? AND t.user_id=?",
      )
      .get(id, userId) as Subtask | undefined;
    return s ? { ...s, completed: !!s.completed } : notFound();
  },
  add: (todoId: number, userId: number, title: string, position?: number) => {
    todoDB.get(todoId, userId);
    const p =
      position ??
      (
        db
          .prepare(
            "SELECT COALESCE(MAX(position),-1)+1 AS p FROM subtasks WHERE todo_id=?",
          )
          .get(todoId) as { p: number }
      ).p;
    const r = db
      .prepare(
        "INSERT INTO subtasks(todo_id,title,position,created_at) VALUES (?,?,?,?)",
      )
      .run(todoId, title, p, singaporeISO());
    return subtaskDB.get(Number(r.lastInsertRowid), userId);
  },
  update: (
    id: number,
    userId: number,
    data: { title?: string; completed?: boolean },
  ) => {
    const s = subtaskDB.get(id, userId);
    db.prepare("UPDATE subtasks SET title=?,completed=? WHERE id=?").run(
      data.title ?? s.title,
      +(data.completed ?? s.completed),
      id,
    );
    return subtaskDB.get(id, userId);
  },
  delete: (id: number, userId: number) => {
    subtaskDB.get(id, userId);
    db.prepare("DELETE FROM subtasks WHERE id=?").run(id);
  },
};
export const tagDB = {
  all: (userId: number) =>
    db
      .prepare("SELECT * FROM tags WHERE user_id=? ORDER BY name")
      .all(userId) as Tag[],
  get: (id: number, userId: number) =>
    (db
      .prepare("SELECT * FROM tags WHERE id=? AND user_id=?")
      .get(id, userId) as Tag | undefined) ?? notFound(),
  create: (userId: number, data: { name: string; color: string }) => {
    const r = db
      .prepare(
        "INSERT INTO tags(user_id,name,color,created_at) VALUES (?,?,?,?)",
      )
      .run(userId, data.name, data.color, singaporeISO());
    return tagDB.get(Number(r.lastInsertRowid), userId);
  },
  update: (
    id: number,
    userId: number,
    data: { name: string; color: string },
  ) => {
    tagDB.get(id, userId);
    db.prepare("UPDATE tags SET name=?,color=? WHERE id=? AND user_id=?").run(
      data.name,
      data.color,
      id,
      userId,
    );
    return tagDB.get(id, userId);
  },
  delete: (id: number, userId: number) => {
    tagDB.get(id, userId);
    db.prepare("DELETE FROM tags WHERE id=? AND user_id=?").run(id, userId);
  },
  attach: (todoId: number, tagId: number, userId: number) => {
    todoDB.get(todoId, userId);
    tagDB.get(tagId, userId);
    db.prepare("INSERT OR IGNORE INTO todo_tags VALUES (?,?)").run(
      todoId,
      tagId,
    );
  },
  detach: (todoId: number, tagId: number, userId: number) => {
    todoDB.get(todoId, userId);
    tagDB.get(tagId, userId);
    db.prepare("DELETE FROM todo_tags WHERE todo_id=? AND tag_id=?").run(
      todoId,
      tagId,
    );
  },
};
export const templateDB = {
  all: (userId: number) =>
    (
      db
        .prepare("SELECT * FROM templates WHERE user_id=? ORDER BY name")
        .all(userId) as Template[]
    ).map((t) => ({ ...t, is_recurring: !!t.is_recurring })),
  get: (id: number, userId: number) => {
    const t = db
      .prepare("SELECT * FROM templates WHERE id=? AND user_id=?")
      .get(id, userId) as Template | undefined;
    return t ? { ...t, is_recurring: !!t.is_recurring } : notFound();
  },
  create: (userId: number, value: unknown) => {
    const d = templateSchema.parse(value);
    const r = db
      .prepare(
        "INSERT INTO templates(user_id,name,description,category,title_template,priority,is_recurring,recurrence_pattern,reminder_minutes,due_date_offset_minutes,subtasks_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        userId,
        d.name,
        d.description,
        d.category,
        d.title_template,
        d.priority,
        +d.is_recurring,
        d.recurrence_pattern,
        d.reminder_minutes,
        d.due_date_offset_minutes,
        d.subtasks_json,
        singaporeISO(),
      );
    return templateDB.get(Number(r.lastInsertRowid), userId);
  },
  update: (id: number, userId: number, value: unknown) => {
    const d = templateSchema.parse({
      ...templateDB.get(id, userId),
      ...(value as object),
    });
    db.prepare(
      "UPDATE templates SET name=?,description=?,category=?,title_template=?,priority=?,is_recurring=?,recurrence_pattern=?,reminder_minutes=?,due_date_offset_minutes=?,subtasks_json=? WHERE id=? AND user_id=?",
    ).run(
      d.name,
      d.description,
      d.category,
      d.title_template,
      d.priority,
      +d.is_recurring,
      d.recurrence_pattern,
      d.reminder_minutes,
      d.due_date_offset_minutes,
      d.subtasks_json,
      id,
      userId,
    );
    return templateDB.get(id, userId);
  },
  delete: (id: number, userId: number) => {
    templateDB.get(id, userId);
    db.prepare("DELETE FROM templates WHERE id=? AND user_id=?").run(
      id,
      userId,
    );
  },
  use: db.transaction((id: number, userId: number) => {
    const t = templateDB.get(id, userId);
    const next = todoDB.create(userId, {
      title: t.title_template,
      priority: t.priority,
      is_recurring: t.is_recurring,
      recurrence_pattern: t.recurrence_pattern,
      reminder_minutes: t.reminder_minutes,
      due_date:
        t.due_date_offset_minutes === null
          ? null
          : addMinutes(t.due_date_offset_minutes),
    });
    for (const s of parseTemplateSubtasks(t.subtasks_json))
      subtaskDB.add(next.id, userId, s.title, s.position);
    return todoDB.get(next.id, userId);
  }),
};
export const holidayDB = {
  all: () =>
    db
      .prepare("SELECT id,date,name FROM holidays ORDER BY date")
      .all() as Holiday[],
  seed: (date: string, name: string) =>
    db
      .prepare(
        "INSERT INTO holidays(date,name,created_at) VALUES (?,?,?) ON CONFLICT(date) DO UPDATE SET name=excluded.name",
      )
      .run(date, name, singaporeISO()),
};
