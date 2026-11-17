import type { Todo, Subtask } from "./db";
import { getSingaporeNow, parseSingaporeDate, singaporeDay } from "./timezone";
export interface FilterState {
  search: string;
  priority: string;
  tagId: string;
  completion: string;
  dueDateFrom: string;
  dueDateTo: string;
}
export const defaultFilters: FilterState = {
  search: "",
  priority: "all",
  tagId: "all",
  completion: "all",
  dueDateFrom: "",
  dueDateTo: "",
};
export function hasActiveFilters(f: FilterState) {
  return Object.keys(defaultFilters).some(
    (k) => f[k as keyof FilterState] !== defaultFilters[k as keyof FilterState],
  );
}
export function applyFilters(todos: Todo[], f: FilterState) {
  const query = f.search.trim().toLowerCase();
  return todos
    .filter(
      (t) =>
        !query ||
        t.title.toLowerCase().includes(query) ||
        t.subtasks?.some((s) => s.title.toLowerCase().includes(query)),
    )
    .filter((t) => f.priority === "all" || t.priority === f.priority)
    .filter(
      (t) => f.tagId === "all" || t.tags?.some((tag) => tag.id === +f.tagId),
    )
    .filter(
      (t) =>
        f.completion === "all" ||
        t.completed === (f.completion === "completed"),
    )
    .filter(
      (t) =>
        (!f.dueDateFrom && !f.dueDateTo) ||
        (!!t.due_date &&
          (!f.dueDateFrom || singaporeDay(t.due_date) >= f.dueDateFrom) &&
          (!f.dueDateTo || singaporeDay(t.due_date) <= f.dueDateTo)),
    );
}
const rank = { high: 0, medium: 1, low: 2 };
export function sortTodos(todos: Todo[]) {
  return [...todos].sort(
    (a, b) =>
      rank[a.priority] - rank[b.priority] ||
      (a.due_date ? parseSingaporeDate(a.due_date).getTime() : Infinity) -
        (b.due_date ? parseSingaporeDate(b.due_date).getTime() : Infinity) ||
      parseSingaporeDate(b.created_at).getTime() -
        parseSingaporeDate(a.created_at).getTime() ||
      b.id - a.id,
  );
}
export function sectionTodos(todos: Todo[], now = getSingaporeNow().getTime()) {
  return {
    Overdue: sortTodos(
      todos.filter(
        (t) =>
          !t.completed &&
          t.due_date &&
          parseSingaporeDate(t.due_date).getTime() < now,
      ),
    ),
    Pending: sortTodos(
      todos.filter(
        (t) =>
          !t.completed &&
          (!t.due_date || parseSingaporeDate(t.due_date).getTime() >= now),
      ),
    ),
    Completed: sortTodos(todos.filter((t) => t.completed)),
  };
}
export function calculateProgress(subtasks: Subtask[]) {
  const completed = subtasks.filter((s) => s.completed).length,
    total = subtasks.length;
  return {
    completed,
    total,
    percent: total ? Math.round((completed / total) * 100) : 0,
  };
}
export function toCSV(todos: Todo[]) {
  const quote = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  return [
    "ID,Title,Completed,Due Date,Priority,Recurring,Pattern,Reminder",
    ...todos.map((t) =>
      [
        t.id,
        t.title,
        t.completed,
        t.due_date,
        t.priority,
        t.is_recurring,
        t.recurrence_pattern,
        t.reminder_minutes,
      ]
        .map(quote)
        .join(","),
    ),
  ].join("\r\n");
}
