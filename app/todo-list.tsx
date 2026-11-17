"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Priority, Todo } from "@/lib/db";
import {
  fromSingaporeDateTimeInput,
  formatSingaporeDate,
  getSingaporeDateTimeInputAfter,
  getSingaporeNow,
  toSingaporeDateTimeInput,
} from "@/lib/timezone";
import { sectionTodos } from "@/lib/todoSort";

type TodoView = Omit<Todo, "user_id"> & { user_id?: number };
type TodoDraft = {
  title: string;
  dueDate: string;
  priority: Priority;
};

const PRIORITIES: Priority[] = ["high", "medium", "low"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTodo(value: unknown): value is Todo {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "number" &&
    typeof value.user_id === "number" &&
    typeof value.title === "string" &&
    typeof value.completed === "boolean" &&
    (value.due_date === null || typeof value.due_date === "string") &&
    (value.priority === "high" ||
      value.priority === "medium" ||
      value.priority === "low") &&
    typeof value.is_recurring === "boolean" &&
    (value.recurrence_pattern === null ||
      typeof value.recurrence_pattern === "string") &&
    (value.reminder_minutes === null ||
      typeof value.reminder_minutes === "number") &&
    (value.last_notification_sent === null ||
      typeof value.last_notification_sent === "string") &&
    typeof value.created_at === "string" &&
    Number.isFinite(Date.parse(value.created_at)) &&
    (value.updated_at === null ||
      (typeof value.updated_at === "string" &&
        Number.isFinite(Date.parse(value.updated_at)))) &&
    (value.due_date === null || Number.isFinite(Date.parse(value.due_date)))
  );
}

function extractTodo(value: unknown): Todo | null {
  if (isTodo(value)) {
    return value;
  }

  if (isRecord(value) && isTodo(value.todo)) {
    return value.todo;
  }

  return null;
}

async function fetchTodoList(signal?: AbortSignal): Promise<Todo[]> {
  const response = await fetch("/api/todos", { signal });
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "Could not load todos."));
  }

  const body: unknown = await response.json();
  const list: unknown[] | null = Array.isArray(body)
    ? body
    : isRecord(body) && Array.isArray(body.todos)
      ? body.todos
      : null;
  if (!list || !list.every(isTodo)) {
    throw new Error("The server returned an invalid todo list.");
  }

  return list;
}

function formatDueDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "Invalid due date";
  }

  return formatSingaporeDate(date, "yyyy-MM-dd HH:mm");
}

async function getErrorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (isRecord(body) && typeof body.error === "string") {
      return body.error;
    }
  } catch {
    return fallback;
  }

  return fallback;
}

function isDueDateAtLeastOneMinuteAhead(value: string): boolean {
  const date = fromSingaporeDateTimeInput(value);
  return date !== null && Date.parse(date) >= getSingaporeNow().getTime() + 60_000;
}

function isPriority(value: string): value is Priority {
  return value === "high" || value === "medium" || value === "low";
}

function PrioritySelect({
  value,
  onChange,
  id,
}: {
  value: Priority;
  onChange: (value: Priority) => void;
  id: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-gray-700 dark:text-gray-200" htmlFor={id}>
        Priority
      </label>
      <select
        className="min-h-11 rounded-lg border border-gray-300 bg-white px-3 text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
        id={id}
        onChange={(event) => {
          if (isPriority(event.target.value)) {
            onChange(event.target.value);
          }
        }}
        value={value}
      >
        {PRIORITIES.map((priority) => (
          <option key={priority} value={priority}>
            {priority[0].toUpperCase() + priority.slice(1)}
          </option>
        ))}
      </select>
    </div>
  );
}

function TodoItem({
  todo,
  busy,
  onToggle,
  onEdit,
  onDelete,
}: {
  todo: TodoView;
  busy: boolean;
  onToggle: (id: number, completed: boolean) => void;
  onEdit: (todo: TodoView) => void;
  onDelete: (todo: TodoView) => void;
}) {
  return (
    <li className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between dark:border-gray-700 dark:bg-gray-800">
      <div className="flex min-w-0 items-start gap-3">
        <input
          aria-label={`Mark "${todo.title}" as ${todo.completed ? "incomplete" : "complete"}`}
          checked={todo.completed}
          className="mt-1 h-5 w-5 shrink-0 accent-blue-600"
          disabled={busy || todo.id < 0}
          onChange={(event) => onToggle(todo.id, event.target.checked)}
          type="checkbox"
        />
        <div className="min-w-0">
          <p
            className={`break-words font-medium ${
              todo.completed
                ? "text-gray-500 line-through dark:text-gray-400"
                : "text-gray-900 dark:text-white"
            }`}
          >
            {todo.title}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-gray-300 px-2.5 py-0.5 text-xs font-medium text-gray-700 dark:border-gray-600 dark:text-gray-200">
              {todo.priority[0].toUpperCase() + todo.priority.slice(1)}
            </span>
            {todo.due_date && (
              <span className="text-sm text-gray-600 dark:text-gray-300">
                Due {formatDueDate(todo.due_date)}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 gap-4 pl-8 text-sm sm:pl-0">
        <button
          className="font-medium text-blue-700 underline-offset-2 hover:underline disabled:opacity-50 dark:text-blue-300"
          disabled={busy || todo.id < 0}
          onClick={() => onEdit(todo)}
          type="button"
        >
          Edit
        </button>
        <button
          className="font-medium text-red-700 underline-offset-2 hover:underline disabled:opacity-50 dark:text-red-300"
          disabled={busy || todo.id < 0}
          onClick={() => onDelete(todo)}
          type="button"
        >
          Delete
        </button>
      </div>
    </li>
  );
}

function TodoSection({
  title,
  todos,
  pendingIds,
  onToggle,
  onEdit,
  onDelete,
}: {
  title: string;
  todos: TodoView[];
  pendingIds: Set<number>;
  onToggle: (id: number, completed: boolean) => void;
  onEdit: (todo: TodoView) => void;
  onDelete: (todo: TodoView) => void;
}) {
  if (todos.length === 0) {
    return null;
  }

  const headingId = `${title.toLowerCase()}-heading`;

  return (
    <section aria-labelledby={headingId} className="mt-8">
      <h2
        className={`mb-3 text-lg font-semibold ${
          title === "Overdue"
            ? "text-red-700 dark:text-red-300"
            : "text-gray-800 dark:text-gray-100"
        }`}
        id={headingId}
      >
        {title} ({todos.length})
      </h2>
      <ul className="space-y-3">
        {todos.map((todo) => (
          <TodoItem
            busy={pendingIds.has(todo.id)}
            key={todo.id}
            onDelete={onDelete}
            onEdit={onEdit}
            onToggle={onToggle}
            todo={todo}
          />
        ))}
      </ul>
    </section>
  );
}

export default function HomePage() {
  const [todos, setTodos] = useState<TodoView[]>([]);
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [editingTodo, setEditingTodo] = useState<TodoView | null>(null);
  const [editDraft, setEditDraft] = useState<TodoDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [pendingIds, setPendingIds] = useState<Set<number>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(getSingaporeNow);

  const loadTodos = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      setTodos(await fetchTodoList(signal));
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") {
        return;
      }
      setError(caught instanceof Error ? caught.message : "Could not load todos.");
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    void fetchTodoList(controller.signal)
      .then((list) => {
        if (active) {
          setTodos(list);
        }
      })
      .catch((caught: unknown) => {
        if (active && !(caught instanceof DOMException && caught.name === "AbortError")) {
          setError(caught instanceof Error ? caught.message : "Could not load todos.");
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(getSingaporeNow()), 30_000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (!editingTodo) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isSavingEdit) {
        setEditingTodo(null);
        setEditDraft(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [editingTodo, isSavingEdit]);

  const sections = useMemo(() => sectionTodos(todos, now), [todos, now]);
  const hasTodos = todos.length > 0;

  function markTodoPending(id: number, pending: boolean) {
    setPendingIds((current) => {
      const next = new Set(current);
      if (pending) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  async function createTodo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("Title is required.");
      return;
    }

    const dueDateISO = dueDate ? fromSingaporeDateTimeInput(dueDate) : null;
    if (dueDate && !dueDateISO) {
      setError("Enter a valid due date and time.");
      return;
    }
    if (dueDate && !isDueDateAtLeastOneMinuteAhead(dueDate)) {
      setError("Due date must be at least 1 minute in the future.");
      return;
    }

    const optimisticId = -Date.now();
    const optimisticTodo: TodoView = {
      id: optimisticId,
      title: trimmedTitle,
      completed: false,
      due_date: dueDateISO,
      priority,
      is_recurring: false,
      recurrence_pattern: null,
      reminder_minutes: null,
      last_notification_sent: null,
      created_at: getSingaporeNow().toISOString(),
      updated_at: null,
    };

    setError(null);
    setIsCreating(true);
    setTodos((current) => [...current, optimisticTodo]);

    try {
      const response = await fetch("/api/todos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: trimmedTitle,
          due_date: dueDateISO,
          priority,
        }),
      });
      if (!response.ok) {
        throw new Error(await getErrorMessage(response, "Could not create todo."));
      }

      const saved = extractTodo(await response.json());
      if (!saved) {
        throw new Error("The server returned an invalid todo.");
      }

      setTodos((current) =>
        current.map((todo) => (todo.id === optimisticId ? saved : todo)),
      );
      setTitle("");
      setDueDate("");
      setPriority("medium");
    } catch (caught) {
      setTodos((current) => current.filter((todo) => todo.id !== optimisticId));
      setError(caught instanceof Error ? caught.message : "Could not create todo.");
    } finally {
      setIsCreating(false);
    }
  }

  async function toggleTodo(id: number, completed: boolean) {
    const previousTodo = todos.find((todo) => todo.id === id);
    if (!previousTodo) {
      return;
    }

    const optimisticTodo = {
      ...previousTodo,
      completed,
      updated_at: getSingaporeNow().toISOString(),
    };
    setError(null);
    markTodoPending(id, true);
    setTodos((current) =>
      current.map((todo) => (todo.id === id ? optimisticTodo : todo)),
    );

    try {
      const response = await fetch(`/api/todos/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed }),
      });
      if (!response.ok) {
        throw new Error(await getErrorMessage(response, "Could not update todo."));
      }

      const updated = extractTodo(await response.json());
      if (!updated) {
        throw new Error("The server returned an invalid todo.");
      }

      setTodos((current) =>
        current.map((todo) => (todo.id === id ? updated : todo)),
      );
    } catch (caught) {
      setTodos((current) =>
        current.map((todo) => (todo.id === id ? previousTodo : todo)),
      );
      setError(caught instanceof Error ? caught.message : "Could not update todo.");
    } finally {
      markTodoPending(id, false);
    }
  }

  function beginEdit(todo: TodoView) {
    setEditingTodo(todo);
    setEditDraft({
      title: todo.title,
      dueDate: toSingaporeDateTimeInput(todo.due_date),
      priority: todo.priority,
    });
    setError(null);
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingTodo || !editDraft) {
      return;
    }

    const trimmedTitle = editDraft.title.trim();
    if (!trimmedTitle) {
      setError("Title cannot be empty.");
      return;
    }

    const originalDueDateInput = toSingaporeDateTimeInput(editingTodo.due_date);
    const dueDateChanged = editDraft.dueDate !== originalDueDateInput;
    const dueDateISO = dueDateChanged
      ? editDraft.dueDate
        ? fromSingaporeDateTimeInput(editDraft.dueDate)
        : null
      : editingTodo.due_date;
    if (dueDateChanged && editDraft.dueDate && !dueDateISO) {
      setError("Enter a valid due date and time.");
      return;
    }
    if (
      dueDateChanged &&
      editDraft.dueDate &&
      !isDueDateAtLeastOneMinuteAhead(editDraft.dueDate)
    ) {
      setError("Due date must be at least 1 minute in the future.");
      return;
    }

    const update: Partial<Pick<Todo, "title" | "due_date" | "priority">> = {};
    if (trimmedTitle !== editingTodo.title) {
      update.title = trimmedTitle;
    }
    if (dueDateChanged) {
      update.due_date = dueDateISO;
    }
    if (editDraft.priority !== editingTodo.priority) {
      update.priority = editDraft.priority;
    }

    if (Object.keys(update).length === 0) {
      setEditingTodo(null);
      setEditDraft(null);
      return;
    }

    const previousTodo = editingTodo;
    const optimisticTodo = {
      ...previousTodo,
      ...update,
      updated_at: getSingaporeNow().toISOString(),
    };
    setIsSavingEdit(true);
    setError(null);
    markTodoPending(previousTodo.id, true);
    setTodos((current) =>
      current.map((todo) =>
        todo.id === previousTodo.id ? optimisticTodo : todo,
      ),
    );

    try {
      const response = await fetch(`/api/todos/${previousTodo.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });
      if (!response.ok) {
        throw new Error(await getErrorMessage(response, "Could not update todo."));
      }

      const updated = extractTodo(await response.json());
      if (!updated) {
        throw new Error("The server returned an invalid todo.");
      }

      setTodos((current) =>
        current.map((todo) =>
          todo.id === previousTodo.id ? updated : todo,
        ),
      );
      setEditingTodo(null);
      setEditDraft(null);
    } catch (caught) {
      setTodos((current) =>
        current.map((todo) =>
          todo.id === previousTodo.id ? previousTodo : todo,
        ),
      );
      setError(caught instanceof Error ? caught.message : "Could not update todo.");
    } finally {
      markTodoPending(previousTodo.id, false);
      setIsSavingEdit(false);
    }
  }

  async function deleteTodo(todo: TodoView) {
    const index = todos.findIndex((item) => item.id === todo.id);
    setError(null);
    markTodoPending(todo.id, true);
    setTodos((current) => current.filter((item) => item.id !== todo.id));

    try {
      const response = await fetch(`/api/todos/${todo.id}`, { method: "DELETE" });
      if (!response.ok) {
        throw new Error(await getErrorMessage(response, "Could not delete todo."));
      }
    } catch (caught) {
      setTodos((current) => {
        if (current.some((item) => item.id === todo.id)) {
          return current;
        }
        const restored = [...current];
        restored.splice(Math.max(0, Math.min(index, restored.length)), 0, todo);
        return restored;
      });
      setError(caught instanceof Error ? caught.message : "Could not delete todo.");
    } finally {
      markTodoPending(todo.id, false);
    }
  }

  return (
    <section aria-label="Todo list" className="w-full">
      <header className="mb-8">
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">
          Todo App
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl dark:text-white">
          Make room for what matters.
        </h1>
      </header>

      <form
        className="grid gap-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:grid-cols-2 sm:p-6 dark:border-gray-700 dark:bg-gray-800"
        onSubmit={createTodo}
      >
        <div className="flex flex-col gap-1 sm:col-span-2">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-200" htmlFor="todo-title">
            Todo
          </label>
          <input
            autoComplete="off"
            className="min-h-11 rounded-lg border border-gray-300 bg-white px-3 text-gray-900 placeholder:text-gray-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            id="todo-title"
            onChange={(event) => setTitle(event.target.value)}
            placeholder="What needs to get done?"
            value={title}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-200" htmlFor="todo-due-date">
            Due date and time <span className="font-normal text-gray-500">(optional, Singapore time)</span>
          </label>
          <input
            className="min-h-11 rounded-lg border border-gray-300 bg-white px-3 text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            id="todo-due-date"
            min={getSingaporeDateTimeInputAfter(60_000)}
            onChange={(event) => setDueDate(event.target.value)}
            type="datetime-local"
            value={dueDate}
          />
        </div>

        <PrioritySelect
          id="todo-priority"
          onChange={setPriority}
          value={priority}
        />

        <div className="sm:col-span-2">
          <button
            className="min-h-11 w-full rounded-lg bg-blue-700 px-5 font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto dark:bg-blue-600 dark:hover:bg-blue-500"
            disabled={isCreating}
            type="submit"
          >
            {isCreating ? "Adding…" : "Add"}
          </button>
        </div>
      </form>

      {error && (
        <div
          className="mt-5 flex items-start justify-between gap-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100"
          role="alert"
        >
          <p>{error}</p>
          {error === "Could not load todos." && (
            <button
              className="shrink-0 font-semibold underline"
              onClick={() => void loadTodos()}
              type="button"
            >
              Retry
            </button>
          )}
        </div>
      )}

      {loading ? (
        <p className="mt-8 text-gray-600 dark:text-gray-300" role="status">
          Loading todos…
        </p>
      ) : !hasTodos && !error ? (
        <section
          aria-live="polite"
          className="mt-8 rounded-xl border border-dashed border-gray-300 bg-white/70 px-4 py-10 text-center text-gray-600 dark:border-gray-700 dark:bg-gray-800/70 dark:text-gray-300"
        >
          You have no todos yet. Add one above to get started.
        </section>
      ) : hasTodos ? (
        <>
          <TodoSection
            onDelete={deleteTodo}
            onEdit={beginEdit}
            onToggle={toggleTodo}
            pendingIds={pendingIds}
            title="Overdue"
            todos={sections.overdue}
          />
          <TodoSection
            onDelete={deleteTodo}
            onEdit={beginEdit}
            onToggle={toggleTodo}
            pendingIds={pendingIds}
            title="Pending"
            todos={sections.pending}
          />
          <TodoSection
            onDelete={deleteTodo}
            onEdit={beginEdit}
            onToggle={toggleTodo}
            pendingIds={pendingIds}
            title="Completed"
            todos={sections.completed}
          />
        </>
      ) : null}

      {editingTodo && editDraft && (
        <div
          className="fixed inset-0 z-10 flex items-center justify-center bg-black/50 p-4"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !isSavingEdit) {
              setEditingTodo(null);
              setEditDraft(null);
            }
          }}
        >
          <section
            aria-labelledby="edit-todo-heading"
            aria-modal="true"
            className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl sm:p-6 dark:bg-gray-800"
            role="dialog"
          >
            <h2
              className="mb-5 text-xl font-semibold text-gray-900 dark:text-white"
              id="edit-todo-heading"
            >
              Edit todo
            </h2>
            <form className="grid gap-4 sm:grid-cols-2" onSubmit={saveEdit}>
              <div className="flex flex-col gap-1 sm:col-span-2">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-200" htmlFor="edit-todo-title">
                  Todo
                </label>
                <input
                  autoFocus
                  className="min-h-11 rounded-lg border border-gray-300 bg-white px-3 text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                  id="edit-todo-title"
                  onChange={(event) =>
                    setEditDraft({ ...editDraft, title: event.target.value })
                  }
                  value={editDraft.title}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-200" htmlFor="edit-todo-due-date">
                  Due date and time <span className="font-normal text-gray-500">(optional, Singapore time)</span>
                </label>
                <input
                  className="min-h-11 rounded-lg border border-gray-300 bg-white px-3 text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                  id="edit-todo-due-date"
                  onChange={(event) =>
                    setEditDraft({ ...editDraft, dueDate: event.target.value })
                  }
                  type="datetime-local"
                  value={editDraft.dueDate}
                />
              </div>
              <PrioritySelect
                id="edit-todo-priority"
                onChange={(value) =>
                  setEditDraft({ ...editDraft, priority: value })
                }
                value={editDraft.priority}
              />
              <div className="flex justify-end gap-3 pt-2 sm:col-span-2">
                <button
                  className="min-h-11 rounded-lg border border-gray-300 px-4 font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-600 dark:text-gray-100 dark:hover:bg-gray-700"
                  disabled={isSavingEdit}
                  onClick={() => {
                    setEditingTodo(null);
                    setEditDraft(null);
                  }}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="min-h-11 rounded-lg bg-blue-700 px-4 font-semibold text-white hover:bg-blue-800 disabled:opacity-60 dark:bg-blue-600 dark:hover:bg-blue-500"
                  disabled={isSavingEdit}
                  type="submit"
                >
                  {isSavingEdit ? "Updating…" : "Update"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}
