import { getSingaporeNow } from "@/lib/timezone";

type Priority = "high" | "medium" | "low";

type SortableTodo = {
  completed: boolean;
  completed_at: string | null;
  created_at: string;
  due_date: string | null;
  priority: Priority;
  updated_at: string | null;
};

export type PriorityFilter = Priority | "all";

const PRIORITY_ORDER: Record<Priority, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

export function sortTodos<T extends SortableTodo>(todos: T[]): T[] {
  return [...todos].sort((a, b) => {
    const priorityDifference = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (priorityDifference !== 0) {
      return priorityDifference;
    }

    const aDue = a.due_date ? Date.parse(a.due_date) : Number.POSITIVE_INFINITY;
    const bDue = b.due_date ? Date.parse(b.due_date) : Number.POSITIVE_INFINITY;
    if (aDue !== bDue) {
      return aDue - bDue;
    }

    return Date.parse(b.created_at) - Date.parse(a.created_at);
  });
}

export function filterTodosByPriority<T extends Pick<SortableTodo, "priority">>(
  todos: T[],
  priority: PriorityFilter,
): T[] {
  return priority === "all"
    ? todos
    : todos.filter((todo) => todo.priority === priority);
}

export function sectionTodos<T extends SortableTodo>(
  todos: T[],
  now: Date = getSingaporeNow(),
): { overdue: T[]; pending: T[]; completed: T[] } {
  const incomplete = todos.filter((todo) => !todo.completed);
  const overdue = incomplete.filter(
    (todo) => todo.due_date !== null && Date.parse(todo.due_date) < now.getTime(),
  );
  const pending = incomplete.filter(
    (todo) => todo.due_date === null || Date.parse(todo.due_date) >= now.getTime(),
  );
  const completed = todos
    .filter((todo) => todo.completed)
    .sort(
      (a, b) => {
        if (a.completed_at === null) return b.completed_at === null ? 0 : 1;
        if (b.completed_at === null) return -1;
        return Date.parse(b.completed_at) - Date.parse(a.completed_at);
      },
    );

  return {
    overdue: sortTodos(overdue),
    pending: sortTodos(pending),
    completed,
  };
}
