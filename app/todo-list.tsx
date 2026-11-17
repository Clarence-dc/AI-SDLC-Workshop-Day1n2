"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Priority, Subtask, Todo } from "@/lib/db";
import { calculateProgress } from "@/lib/subtaskProgress";
import {
  fromSingaporeDateTimeInput,
  formatSingaporeDate,
  getSingaporeDateTimeInputAfter,
  getSingaporeNow,
  toSingaporeDateTimeInput,
} from "@/lib/timezone";
import {
  filterTodosByPriority,
  sectionTodos,
  type PriorityFilter,
} from "@/lib/todoSort";

type TodoView = Omit<Todo, "user_id" | "subtasks"> & {
  user_id?: number;
  subtasks: Subtask[];
};
type TodoDraft = {
  title: string;
  dueDate: string;
  priority: Priority;
};

const PRIORITIES: Priority[] = ["high", "medium", "low"];
const PRIORITY_BADGE_STYLES: Record<Priority, string> = {
  high: "border-red-500 bg-red-50 text-red-800 dark:border-red-400 dark:bg-red-950 dark:text-red-200",
  medium:
    "border-amber-500 bg-amber-50 text-amber-900 dark:border-amber-400 dark:bg-amber-950 dark:text-amber-200",
  low: "border-blue-500 bg-blue-50 text-blue-800 dark:border-blue-400 dark:bg-blue-950 dark:text-blue-200",
};
let nextOptimisticSubtaskId = -1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSubtask(value: unknown, todoId?: number): value is Subtask {
  return (
    isRecord(value) &&
    Number.isSafeInteger(value.id) &&
    Number(value.id) > 0 &&
    Number.isSafeInteger(value.todo_id) &&
    Number(value.todo_id) > 0 &&
    (todoId === undefined || value.todo_id === todoId) &&
    typeof value.title === "string" &&
    typeof value.completed === "boolean" &&
    Number.isSafeInteger(value.position) &&
    Number(value.position) >= 0 &&
    typeof value.created_at === "string" &&
    Number.isFinite(Date.parse(value.created_at))
  );
}

function isTodo(value: unknown): value is Todo & { subtasks: Subtask[] } {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "number" &&
    typeof value.user_id === "number" &&
    typeof value.title === "string" &&
    typeof value.completed === "boolean" &&
    (value.completed_at === null ||
      (typeof value.completed_at === "string" &&
        Number.isFinite(Date.parse(value.completed_at)))) &&
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
    (value.due_date === null || Number.isFinite(Date.parse(value.due_date))) &&
    Array.isArray(value.subtasks) &&
    value.subtasks.every((subtask) => isSubtask(subtask, Number(value.id)))
  );
}

function extractTodo(value: unknown): TodoView | null {
  if (isTodo(value)) {
    return value;
  }

  if (isRecord(value) && isTodo(value.todo)) {
    return value.todo;
  }

  return null;
}

async function fetchTodoList(signal?: AbortSignal): Promise<TodoView[]> {
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

function compareSubtasks(a: Subtask, b: Subtask): number {
  return a.position - b.position || a.id - b.id;
}

function sortSubtasks(subtasks: Subtask[]): Subtask[] {
  return [...subtasks].sort(compareSubtasks);
}

function subtaskPendingKey(todoId: number, subtaskId?: number): string {
  return subtaskId === undefined
    ? `add:${todoId}`
    : `subtask:${todoId}:${subtaskId}`;
}

function SubtaskList({
  todoId,
  todoTitle,
  subtasks,
  pendingKeys,
  onSubtasksChange,
  registerRequest,
}: {
  todoId: number;
  todoTitle: string;
  subtasks: Subtask[];
  pendingKeys: Set<string>;
  onSubtasksChange: (update: (current: Subtask[]) => Subtask[]) => void;
  registerRequest: (
    todoId: number,
    controller: AbortController,
    lockKey: string,
  ) => (() => void) | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const { completed, total, percent } = calculateProgress(subtasks);
  const panelId = `subtasks-${todoId}`;
  const inputId = `subtask-title-${todoId}`;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function addSubtask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = newTitle.trim();
    if (!title) {
      setError("Subtask title is required.");
      return;
    }
    const addKey = subtaskPendingKey(todoId);
    if (todoId < 0 || pendingKeys.has(addKey)) {
      return;
    }

    const optimisticId = nextOptimisticSubtaskId--;
    const optimisticSubtask: Subtask = {
      id: optimisticId,
      todo_id: todoId,
      title,
      completed: false,
      position: Math.max(-1, ...subtasks.map((subtask) => subtask.position)) + 1,
      created_at: getSingaporeNow().toISOString(),
    };
    const controller = new AbortController();
    const releaseRequest = registerRequest(todoId, controller, addKey);
    if (!releaseRequest) {
      return;
    }

    setError(null);
    onSubtasksChange((current) => sortSubtasks([...current, optimisticSubtask]));

    try {
      const response = await fetch(`/api/todos/${todoId}/subtasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(await getErrorMessage(response, "Could not add subtask."));
      }

      const saved: unknown = await response.json();
      if (!isSubtask(saved, todoId)) {
        throw new Error("The server returned an invalid subtask.");
      }

      onSubtasksChange((current) =>
        sortSubtasks(current.map((subtask) => subtask.id === optimisticId ? saved : subtask)),
      );
      if (mounted.current) {
        setNewTitle("");
      }
    } catch (caught) {
      if (controller.signal.aborted) {
        return;
      }
      onSubtasksChange((current) =>
        current.filter((subtask) => subtask.id !== optimisticId),
      );
      if (mounted.current) {
        setError(caught instanceof Error ? caught.message : "Could not add subtask.");
      }
    } finally {
      releaseRequest();
    }
  }

  async function toggleSubtask(subtask: Subtask, isCompleted: boolean) {
    const lockKey = subtaskPendingKey(todoId, subtask.id);
    if (subtask.id < 0 || pendingKeys.has(lockKey)) {
      return;
    }

    const controller = new AbortController();
    const releaseRequest = registerRequest(todoId, controller, lockKey);
    if (!releaseRequest) {
      return;
    }
    setError(null);
    onSubtasksChange((current) =>
      current.map((item) => item.id === subtask.id ? { ...item, completed: isCompleted } : item),
    );

    try {
      const response = await fetch(`/api/subtasks/${subtask.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed: isCompleted }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(await getErrorMessage(response, "Could not update subtask."));
      }

      const saved: unknown = await response.json();
      if (!isSubtask(saved, todoId) || saved.id !== subtask.id) {
        throw new Error("The server returned an invalid subtask.");
      }
      onSubtasksChange((current) =>
        sortSubtasks(current.map((item) => item.id === subtask.id ? saved : item)),
      );
    } catch (caught) {
      if (controller.signal.aborted) {
        return;
      }
      onSubtasksChange((current) =>
        current.map((item) =>
          item.id === subtask.id ? { ...item, completed: subtask.completed } : item,
        ),
      );
      if (mounted.current) {
        setError(caught instanceof Error ? caught.message : "Could not update subtask.");
      }
    } finally {
      releaseRequest();
    }
  }

  async function deleteSubtask(subtask: Subtask) {
    const lockKey = subtaskPendingKey(todoId, subtask.id);
    if (pendingKeys.has(lockKey)) {
      return;
    }

    const controller = new AbortController();
    const releaseRequest = registerRequest(todoId, controller, lockKey);
    if (!releaseRequest) {
      return;
    }
    setError(null);
    onSubtasksChange((current) => current.filter((item) => item.id !== subtask.id));

    try {
      const response = await fetch(`/api/subtasks/${subtask.id}`, {
        method: "DELETE",
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(await getErrorMessage(response, "Could not delete subtask."));
      }

      const body: unknown = await response.json();
      if (!isRecord(body) || body.success !== true) {
        throw new Error("The server returned an invalid subtask deletion response.");
      }
    } catch (caught) {
      if (controller.signal.aborted) {
        return;
      }
      onSubtasksChange((current) =>
        current.some((item) => item.id === subtask.id)
          ? current
          : sortSubtasks([...current, subtask]),
      );
      if (mounted.current) {
        setError(caught instanceof Error ? caught.message : "Could not delete subtask.");
      }
    } finally {
      releaseRequest();
    }
  }

  return (
    <div className="w-full border-t border-gray-100 pt-3 dark:border-gray-700">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          aria-controls={panelId}
          aria-expanded={expanded}
          className="min-h-9 rounded-md text-sm font-medium text-blue-700 underline-offset-2 hover:underline disabled:opacity-50 dark:text-blue-300"
          onClick={() => setExpanded((current) => !current)}
          type="button"
        >
          {expanded ? "Hide subtasks" : "Show subtasks"}
        </button>
        {total > 0 && (
          <div aria-live="polite" aria-atomic="true" className="min-w-48 flex-1">
            <div className="mb-1 flex justify-between gap-3 text-xs text-gray-600 dark:text-gray-300">
              <span>{completed}/{total} subtasks</span>
              <span>{percent}%</span>
            </div>
            <div
              aria-label={`Subtask progress: ${completed} of ${total} complete (${percent}%)`}
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={percent}
              className="h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700"
              role="progressbar"
            >
              <div
                className={`h-full rounded-full transition-[width] ${
                  percent === 100 ? "bg-green-500" : "bg-blue-500"
                }`}
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        )}
      </div>

      <div className="mt-3 space-y-3" hidden={!expanded} id={panelId}>
        <form className="flex flex-col gap-2 sm:flex-row" onSubmit={addSubtask}>
          <label className="sr-only" htmlFor={inputId}>
            Add subtask to {todoTitle}
          </label>
          <input
            autoComplete="off"
            className="min-h-10 min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 text-gray-900 placeholder:text-gray-500 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            disabled={pendingKeys.has(subtaskPendingKey(todoId)) || todoId < 0}
            id={inputId}
            onChange={(event) => setNewTitle(event.target.value)}
            placeholder="Add a subtask"
            value={newTitle}
          />
          <button
            className="min-h-10 rounded-lg bg-blue-700 px-4 font-medium text-white hover:bg-blue-800 disabled:opacity-50 dark:bg-blue-600 dark:hover:bg-blue-500"
            disabled={pendingKeys.has(subtaskPendingKey(todoId)) || todoId < 0}
            type="submit"
          >
            Add
          </button>
        </form>

        {subtasks.length > 0 && (
          <ul aria-label={`${todoTitle} subtasks`} className="space-y-2 pl-1">
            {subtasks.map((subtask) => {
              const busy = pendingKeys.has(subtaskPendingKey(todoId, subtask.id));
              return (
                <li className="flex min-w-0 items-center gap-3" key={subtask.id}>
                  <input
                    aria-label={`Mark subtask "${subtask.title}" as ${subtask.completed ? "incomplete" : "complete"}`}
                    checked={subtask.completed}
                    className="h-4 w-4 shrink-0 accent-blue-600"
                    disabled={busy || subtask.id < 0}
                    onChange={(event) => void toggleSubtask(subtask, event.target.checked)}
                    type="checkbox"
                  />
                  <span
                    className={`min-w-0 flex-1 break-words text-sm ${
                      subtask.completed
                        ? "text-gray-500 line-through dark:text-gray-400"
                        : "text-gray-800 dark:text-gray-100"
                    }`}
                  >
                    {subtask.title}
                  </span>
                  <button
                    aria-label={`Delete subtask "${subtask.title}"`}
                    className="min-h-9 min-w-9 rounded-md text-lg font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:text-red-300 dark:hover:bg-red-950"
                    disabled={busy}
                    onClick={() => void deleteSubtask(subtask)}
                    type="button"
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        )}

      </div>
      {error && (
        <p aria-live="assertive" className="mt-2 text-sm text-red-700 dark:text-red-300" role="alert">
          {error}
        </p>
      )}
    </div>
  );
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

function PriorityBadge({ priority }: { priority: Priority }) {
  const label = priority[0].toUpperCase() + priority.slice(1);

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${PRIORITY_BADGE_STYLES[priority]}`}
    >
      {label}
    </span>
  );
}

function TodoItem({
  todo,
  busy,
  pendingSubtaskKeys,
  onSubtasksChange,
  registerSubtaskRequest,
  onToggle,
  onEdit,
  onDelete,
}: {
  todo: TodoView;
  busy: boolean;
  pendingSubtaskKeys: Set<string>;
  onSubtasksChange: (
    todoId: number,
    update: (current: Subtask[]) => Subtask[],
  ) => void;
  registerSubtaskRequest: (
    todoId: number,
    controller: AbortController,
    lockKey: string,
  ) => (() => void) | null;
  onToggle: (id: number, completed: boolean) => void;
  onEdit: (todo: TodoView) => void;
  onDelete: (todo: TodoView) => void;
}) {
  return (
    <li className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
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
              <PriorityBadge priority={todo.priority} />
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
      </div>
      <SubtaskList
        onSubtasksChange={(update) => onSubtasksChange(todo.id, update)}
        pendingKeys={pendingSubtaskKeys}
        registerRequest={registerSubtaskRequest}
        subtasks={todo.subtasks}
        todoId={todo.id}
        todoTitle={todo.title}
      />
    </li>
  );
}

function TodoSection({
  title,
  todos,
  pendingIds,
  pendingSubtaskKeys,
  onSubtasksChange,
  registerSubtaskRequest,
  onToggle,
  onEdit,
  onDelete,
}: {
  title: string;
  todos: TodoView[];
  pendingIds: Set<number>;
  pendingSubtaskKeys: Set<string>;
  onSubtasksChange: (
    todoId: number,
    update: (current: Subtask[]) => Subtask[],
  ) => void;
  registerSubtaskRequest: (
    todoId: number,
    controller: AbortController,
    lockKey: string,
  ) => (() => void) | null;
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
            onSubtasksChange={onSubtasksChange}
            onToggle={onToggle}
            pendingSubtaskKeys={pendingSubtaskKeys}
            registerSubtaskRequest={registerSubtaskRequest}
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
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("all");
  const [editingTodo, setEditingTodo] = useState<TodoView | null>(null);
  const [editDraft, setEditDraft] = useState<TodoDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [pendingIds, setPendingIds] = useState<Set<number>>(() => new Set());
  const [pendingSubtaskKeys, setPendingSubtaskKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(getSingaporeNow);
  const subtaskRequests = useRef(new Map<number, Set<AbortController>>());
  const subtaskLocks = useRef(new Set<string>());

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
  const visibleSections = useMemo(
    () => ({
      overdue: filterTodosByPriority(sections.overdue, priorityFilter),
      pending: filterTodosByPriority(sections.pending, priorityFilter),
      completed: filterTodosByPriority(sections.completed, priorityFilter),
    }),
    [priorityFilter, sections],
  );
  const hasTodos = todos.length > 0;
  const hasVisibleTodos =
    visibleSections.overdue.length +
      visibleSections.pending.length +
      visibleSections.completed.length >
    0;

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

  const registerSubtaskRequest = useCallback(
    (todoId: number, controller: AbortController, lockKey: string) => {
      if (subtaskLocks.current.has(lockKey)) {
        return null;
      }
      subtaskLocks.current.add(lockKey);
      setPendingSubtaskKeys((current) => new Set(current).add(lockKey));

      let controllers = subtaskRequests.current.get(todoId);
      if (!controllers) {
        controllers = new Set();
        subtaskRequests.current.set(todoId, controllers);
      }
      controllers.add(controller);

      return () => {
        subtaskLocks.current.delete(lockKey);
        setPendingSubtaskKeys((current) => {
          const next = new Set(current);
          next.delete(lockKey);
          return next;
        });
        const current = subtaskRequests.current.get(todoId);
        current?.delete(controller);
        if (current?.size === 0) {
          subtaskRequests.current.delete(todoId);
        }
      };
    },
    [],
  );

  function updateTodoSubtasks(
    todoId: number,
    update: (current: Subtask[]) => Subtask[],
  ) {
    setTodos((current) =>
      current.map((todo) =>
        todo.id === todoId ? { ...todo, subtasks: update(todo.subtasks) } : todo,
      ),
    );
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
      completed_at: null,
      due_date: dueDateISO,
      priority,
      is_recurring: false,
      recurrence_pattern: null,
      reminder_minutes: null,
      last_notification_sent: null,
      created_at: getSingaporeNow().toISOString(),
      updated_at: null,
      subtasks: [],
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

    const updatedAt = getSingaporeNow().toISOString();
    const optimisticTodo = {
      ...previousTodo,
      completed,
      completed_at: completed ? updatedAt : null,
      updated_at: updatedAt,
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
        current.map((todo) =>
          todo.id === id ? { ...updated, subtasks: todo.subtasks } : todo,
        ),
      );
    } catch (caught) {
      setTodos((current) =>
        current.map((todo) =>
          todo.id === id
            ? { ...previousTodo, subtasks: todo.subtasks }
            : todo,
        ),
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
          todo.id === previousTodo.id
            ? { ...updated, subtasks: todo.subtasks }
            : todo,
        ),
      );
      setEditingTodo(null);
      setEditDraft(null);
    } catch (caught) {
      setTodos((current) =>
        current.map((todo) =>
          todo.id === previousTodo.id
            ? { ...previousTodo, subtasks: todo.subtasks }
            : todo,
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
    for (const controller of subtaskRequests.current.get(todo.id) ?? []) {
      controller.abort();
    }
    subtaskRequests.current.delete(todo.id);
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

      <div className="mt-6 flex flex-col gap-1 sm:max-w-xs">
        <label
          className="text-sm font-medium text-gray-700 dark:text-gray-200"
          htmlFor="priority-filter"
        >
          Filter by priority
        </label>
        <select
          aria-label="Filter todos by priority"
          className="min-h-11 rounded-lg border border-gray-300 bg-white px-3 text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          id="priority-filter"
          onChange={(event) => {
            const value = event.target.value;
            if (value === "all" || isPriority(value)) {
              setPriorityFilter(value);
            }
          }}
          value={priorityFilter}
        >
          <option value="all">All Priorities</option>
          <option value="high">High Priority</option>
          <option value="medium">Medium Priority</option>
          <option value="low">Low Priority</option>
        </select>
      </div>

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
      ) : hasTodos && !hasVisibleTodos ? (
        <section
          aria-live="polite"
          className="mt-8 rounded-xl border border-dashed border-gray-300 bg-white/70 px-4 py-10 text-center text-gray-600 dark:border-gray-700 dark:bg-gray-800/70 dark:text-gray-300"
        >
          No todos match this priority.
        </section>
      ) : hasVisibleTodos ? (
        <>
          <TodoSection
            onDelete={deleteTodo}
            onEdit={beginEdit}
            onSubtasksChange={updateTodoSubtasks}
            onToggle={toggleTodo}
            pendingIds={pendingIds}
            pendingSubtaskKeys={pendingSubtaskKeys}
            registerSubtaskRequest={registerSubtaskRequest}
            title="Overdue"
            todos={visibleSections.overdue}
          />
          <TodoSection
            onDelete={deleteTodo}
            onEdit={beginEdit}
            onSubtasksChange={updateTodoSubtasks}
            onToggle={toggleTodo}
            pendingIds={pendingIds}
            pendingSubtaskKeys={pendingSubtaskKeys}
            registerSubtaskRequest={registerSubtaskRequest}
            title="Pending"
            todos={visibleSections.pending}
          />
          <TodoSection
            onDelete={deleteTodo}
            onEdit={beginEdit}
            onSubtasksChange={updateTodoSubtasks}
            onToggle={toggleTodo}
            pendingIds={pendingIds}
            pendingSubtaskKeys={pendingSubtaskKeys}
            registerSubtaskRequest={registerSubtaskRequest}
            title="Completed"
            todos={visibleSections.completed}
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
