import Database from "better-sqlite3";
import path from "node:path";
import { getSingaporeNow } from "./timezone";
import { TodoValidationError, validateTodoInput } from "./todoValidation";

export type Priority = "high" | "medium" | "low";
export type RecurrencePattern = "daily" | "weekly" | "monthly" | "yearly";

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

export interface Todo {
  id: number;
  user_id: number;
  title: string;
  completed: boolean;
  completed_at: string | null;
  due_date: string | null;
  priority: Priority;
  is_recurring: boolean;
  recurrence_pattern: RecurrencePattern | null;
  reminder_minutes: number | null;
  last_notification_sent: string | null;
  created_at: string;
  updated_at: string | null;
  subtasks?: Subtask[];
  tags?: Tag[];
}

export interface CreateTodoInput {
  title: string;
  due_date?: string | null;
  priority?: Priority;
  is_recurring?: boolean;
  recurrence_pattern?: RecurrencePattern | null;
  reminder_minutes?: number | null;
  tag_ids?: number[];
}

export interface UpdateTodoInput extends Partial<CreateTodoInput> {
  completed?: boolean;
}

interface TodoRow extends Omit<Todo, "completed" | "is_recurring" | "subtasks" | "tags"> {
  completed: number;
  is_recurring: number;
}

export interface User {
  id: number;
  username: string;
  created_at: string;
}

export interface CredentialInput {
  credential_id: string;
  credential_public_key: Buffer;
  counter: number;
  transports?: string[];
}

export interface Authenticator extends CredentialInput {
  id: number;
  user_id: number;
  created_at: string;
}

export interface Challenge {
  id: string;
  user_id: number | null;
  username: string;
  purpose: "register" | "login" | "enroll";
  challenge: string;
  expires_at: number;
}

interface AuthenticatorRow extends Omit<Authenticator, "transports"> {
  transports: string;
}

let connection: Database.Database | undefined;

export function closeDatabase(): void {
  connection?.close();
  connection = undefined;
}

function database(): Database.Database {
  if (connection) return connection;
  const db = new Database(process.env.DATABASE_PATH ?? path.join(process.cwd(), "todos.db"));
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS authenticators (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      credential_id TEXT UNIQUE NOT NULL,
      credential_public_key BLOB NOT NULL,
      counter INTEGER NOT NULL DEFAULT 0 CHECK(counter >= 0),
      transports TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_authenticators_user_id ON authenticators(user_id);
    CREATE TABLE IF NOT EXISTS auth_challenges (
      id TEXT PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      purpose TEXT NOT NULL CHECK(purpose IN ('register','login','enroll')),
      challenge TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_auth_challenges_expires_at ON auth_challenges(expires_at);
    CREATE INDEX IF NOT EXISTS idx_auth_challenges_user_id ON auth_challenges(user_id);
    CREATE TABLE IF NOT EXISTS todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0,1)),
      completed_at TEXT,
      due_date TEXT,
      priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('high','medium','low')),
      is_recurring INTEGER NOT NULL DEFAULT 0 CHECK(is_recurring IN (0,1)),
      recurrence_pattern TEXT,
      reminder_minutes INTEGER,
      last_notification_sent TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_todos_user_id ON todos(user_id);
    CREATE INDEX IF NOT EXISTS idx_todos_due_date ON todos(due_date);
    CREATE TABLE IF NOT EXISTS subtasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      todo_id INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_subtasks_todo_id ON subtasks(todo_id);
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL COLLATE NOCASE,
      color TEXT NOT NULL DEFAULT '#3B82F6',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(user_id, name)
    );
    CREATE INDEX IF NOT EXISTS idx_tags_user_id ON tags(user_id);
    CREATE TABLE IF NOT EXISTS todo_tags (
      todo_id INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY(todo_id, tag_id)
    );
    CREATE INDEX IF NOT EXISTS idx_todo_tags_tag_id ON todo_tags(tag_id);
  `);
  db.transaction(() => {
    const columns = db.pragma("table_info(todos)") as Array<{ name: string }>;
    if (!columns.some(({ name }) => name === "completed_at")) {
      db.exec(`
        ALTER TABLE todos ADD COLUMN completed_at TEXT;
        UPDATE todos SET completed_at = COALESCE(updated_at, created_at)
        WHERE completed = 1;
      `);
    }
  }).immediate();
  connection = db;
  return db;
}

function authenticatorFromRow(row: AuthenticatorRow): Authenticator {
  const transports: unknown = JSON.parse(row.transports);
  if (!Array.isArray(transports) || !transports.every((value) => typeof value === "string")) {
    throw new Error("Invalid stored authenticator transports");
  }
  return { ...row, transports, counter: row.counter ?? 0 };
}

export const userDB = {
  findByUsername(username: string): User | undefined {
    return database().prepare("SELECT * FROM users WHERE username = ?").get(username) as User | undefined;
  },
  findById(id: number): User | undefined {
    return database().prepare("SELECT * FROM users WHERE id = ?").get(id) as User | undefined;
  },
};

export function addAuthenticator(userId: number, credential: CredentialInput): Authenticator {
  const counter = credential.counter ?? 0;
  if (!Number.isSafeInteger(counter) || counter < 0
    || !credential.credential_id || !Buffer.isBuffer(credential.credential_public_key)
    || credential.credential_public_key.length === 0) {
    throw new Error("Invalid authenticator credential");
  }
  const db = database();
  const result = db.prepare(`
    INSERT INTO authenticators(user_id, credential_id, credential_public_key, counter, transports)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId, credential.credential_id, credential.credential_public_key, counter,
    JSON.stringify(credential.transports ?? []));
  const row = db.prepare("SELECT * FROM authenticators WHERE id = ?")
    .get(result.lastInsertRowid) as AuthenticatorRow;
  return authenticatorFromRow(row);
}

export function registerUser(username: string, credential: CredentialInput): User {
  const trimmed = username.trim();
  if (!trimmed || trimmed.length > 64) throw new Error("Invalid username");
  const db = database();
  return db.transaction(() => {
    const result = db.prepare("INSERT INTO users(username) VALUES (?)").run(trimmed);
    const user = userDB.findById(Number(result.lastInsertRowid));
    if (!user) throw new Error("User registration failed");
    addAuthenticator(user.id, credential);
    return user;
  })();
}

export const authenticatorDB = {
  findByCredentialId(credentialId: string): Authenticator | undefined {
    const row = database().prepare("SELECT * FROM authenticators WHERE credential_id = ?")
      .get(credentialId) as AuthenticatorRow | undefined;
    return row ? authenticatorFromRow(row) : undefined;
  },
  findByUserId(userId: number): Authenticator[] {
    const rows = database().prepare("SELECT * FROM authenticators WHERE user_id = ? ORDER BY id")
      .all(userId) as AuthenticatorRow[];
    return rows.map(authenticatorFromRow);
  },
  updateCounter(id: number, counter: number): void {
    if (!Number.isSafeInteger(counter) || counter < 0) throw new Error("Invalid authenticator counter");
    const result = database().prepare(`
      UPDATE authenticators SET counter = ?
      WHERE id = ? AND (counter < ? OR (counter = 0 AND ? = 0))
    `).run(counter, id, counter, counter);
    if (result.changes !== 1) throw new Error("Authenticator counter is stale or credential is missing");
  },
};

export function saveChallenge(record: Challenge): void {
  const db = database();
  db.transaction(() => {
    db.prepare("DELETE FROM auth_challenges WHERE expires_at <= ?").run(Date.now());
    db.prepare(`
      INSERT INTO auth_challenges(id, user_id, username, purpose, challenge, expires_at)
      VALUES (@id, @user_id, @username, @purpose, @challenge, @expires_at)
    `).run(record);
  })();
}

export function consumeChallenge(id: string): Challenge | null {
  const record = database().prepare("DELETE FROM auth_challenges WHERE id = ? RETURNING *")
    .get(id) as Challenge | undefined;
  return record && record.expires_at > Date.now() ? record : null;
}

function todosWithRelations(rows: TodoRow[], userId: number): Todo[] {
  if (!rows.length) return [];
  const db = database();
  const subtasks = db.prepare(`
    SELECT s.* FROM subtasks s JOIN todos t ON t.id = s.todo_id
    WHERE t.user_id = ? ORDER BY s.position, s.id
  `).all(userId) as Array<Omit<Subtask, "completed"> & { completed: number }>;
  const tags = db.prepare(`
    SELECT tags.*, tt.todo_id FROM tags
    JOIN todo_tags tt ON tt.tag_id = tags.id JOIN todos t ON t.id = tt.todo_id
    WHERE t.user_id = ? AND tags.user_id = ?
  `).all(userId, userId) as Array<Tag & { todo_id: number }>;
  const subtasksByTodo = new Map<number, Subtask[]>();
  const tagsByTodo = new Map<number, Tag[]>();
  for (const subtask of subtasks) {
    const list = subtasksByTodo.get(subtask.todo_id) ?? [];
    list.push({ ...subtask, completed: subtask.completed === 1 });
    subtasksByTodo.set(subtask.todo_id, list);
  }
  for (const { todo_id, ...tag } of tags) {
    const list = tagsByTodo.get(todo_id) ?? [];
    list.push(tag);
    tagsByTodo.set(todo_id, list);
  }
  return rows.map((row) => ({
    ...row, completed: row.completed === 1, is_recurring: row.is_recurring === 1,
    subtasks: subtasksByTodo.get(row.id) ?? [], tags: tagsByTodo.get(row.id) ?? [],
  }));
}

function setTodoTags(todoId: number, userId: number, ids: number[]): void {
  const db = database();
  const find = db.prepare("SELECT id FROM tags WHERE id = ? AND user_id = ?");
  for (const id of ids) {
    if (!find.get(id, userId)) throw new TodoValidationError("Tag not found", 404);
  }
  db.prepare("DELETE FROM todo_tags WHERE todo_id = ?").run(todoId);
  const attach = db.prepare("INSERT INTO todo_tags(todo_id, tag_id) VALUES (?, ?)");
  for (const id of new Set(ids)) attach.run(todoId, id);
}

export const todoDB = {
  findAllByUser(userId: number): Todo[] {
    const rows = database().prepare("SELECT * FROM todos WHERE user_id = ? ORDER BY created_at DESC, id DESC")
      .all(userId) as TodoRow[];
    return todosWithRelations(rows, userId);
  },
  findById(id: number, userId: number): Todo | undefined {
    const row = database().prepare("SELECT * FROM todos WHERE id = ? AND user_id = ?")
      .get(id, userId) as TodoRow | undefined;
    return row ? todosWithRelations([row], userId)[0] : undefined;
  },
  create(userId: number, input: unknown): Todo {
    const db = database();
    return db.transaction(() => {
      const data = validateTodoInput(input);
      const result = db.prepare(`
        INSERT INTO todos(user_id, title, due_date, priority, is_recurring,
          recurrence_pattern, reminder_minutes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(userId, data.title, data.due_date ?? null, data.priority ?? "medium",
        data.is_recurring ? 1 : 0, data.recurrence_pattern ?? null,
        data.reminder_minutes ?? null, getSingaporeNow().toISOString());
      const id = Number(result.lastInsertRowid);
      setTodoTags(id, userId, data.tag_ids ?? []);
      const todo = this.findById(id, userId);
      if (!todo) throw new Error("Todo creation failed");
      return todo;
    })();
  },
  update(id: number, userId: number, input: unknown): Todo | undefined {
    const db = database();
    return db.transaction(() => {
      const existing = this.findById(id, userId);
      if (!existing) return undefined;
      const changes = validateTodoInput(input, existing);
      const merged = { ...existing, ...changes };
      const now = getSingaporeNow().toISOString();
      const completedAt = merged.completed
        ? (existing.completed ? existing.completed_at : now)
        : null;
      const reminderChanged = merged.due_date !== existing.due_date
        || merged.reminder_minutes !== existing.reminder_minutes;
      db.prepare(`
        UPDATE todos SET title = ?, completed = ?, completed_at = ?, due_date = ?, priority = ?,
          is_recurring = ?, recurrence_pattern = ?, reminder_minutes = ?,
          last_notification_sent = ?, updated_at = ?
        WHERE id = ? AND user_id = ?
      `).run(merged.title, merged.completed ? 1 : 0, completedAt, merged.due_date, merged.priority,
        merged.is_recurring ? 1 : 0, merged.recurrence_pattern, merged.reminder_minutes,
        reminderChanged ? null : existing.last_notification_sent,
        now, id, userId);
      if (changes.tag_ids !== undefined) setTodoTags(id, userId, changes.tag_ids);
      return this.findById(id, userId);
    })();
  },
  delete(id: number, userId: number): boolean {
    return database().prepare("DELETE FROM todos WHERE id = ? AND user_id = ?")
      .run(id, userId).changes === 1;
  },
};
