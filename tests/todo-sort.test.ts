import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { test } from "node:test";
import { sectionTodos, sortTodos } from "../lib/todoSort";

type SortableTodo = {
  id: number;
  completed: boolean;
  completed_at: string | null;
  created_at: string;
  due_date: string | null;
  priority: "high" | "medium" | "low";
  updated_at: string | null;
};

function todo(
  id: number,
  values: Partial<SortableTodo> = {},
): SortableTodo {
  return {
    id,
    completed: false,
    completed_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    due_date: null,
    priority: "medium",
    updated_at: null,
    ...values,
  };
}

test("sortTodos orders priority, then due date, then newest creation first", () => {
  const todos = [
    todo(1, { priority: "low", due_date: "2026-04-01T00:00:00.000Z" }),
    todo(2, { priority: "high", due_date: "2026-04-02T00:00:00.000Z" }),
    todo(3, { priority: "high", due_date: "2026-04-01T00:00:00.000Z" }),
    todo(4, { priority: "medium", due_date: "2026-04-01T00:00:00.000Z" }),
    todo(5, {
      priority: "medium",
      due_date: "2026-04-01T00:00:00.000Z",
      created_at: "2026-01-02T00:00:00.000Z",
    }),
    todo(6, { priority: "low", due_date: null }),
  ];

  assert.deepEqual(sortTodos(todos).map(({ id }) => id), [3, 2, 5, 4, 1, 6]);
  assert.deepEqual(todos.map(({ id }) => id), [1, 2, 3, 4, 5, 6]);
});

test("sortTodos sorts 500 todos in under 50ms without mutating the input", (t) => {
  const todos = Array.from({ length: 500 }, (_, id) =>
    todo(id, {
      priority: (["high", "medium", "low"] as const)[id % 3],
      due_date: id % 4 === 0
        ? null
        : new Date(1_800_000_000_000 + (id % 37) * 1000).toISOString(),
      created_at: new Date(1_700_000_000_000 + id * 1000).toISOString(),
    }),
  );
  const original = [...todos];
  const durations: number[] = [];

  for (let iteration = 0; iteration < 50; iteration++) {
    const start = performance.now();
    const sorted = sortTodos(todos);
    durations.push(performance.now() - start);
    assert.notEqual(sorted, todos);
    assert.equal(sorted.length, 500);
  }

  assert.deepEqual(todos, original);
  const slowest = Math.max(...durations);
  t.diagnostic(`Slowest of 50 500-todo sorts: ${slowest.toFixed(2)}ms`);
  assert.ok(slowest < 50, `Slowest 500-todo sort took ${slowest.toFixed(2)}ms`);
});

test("sectionTodos puts exact due-time boundaries in Pending and overdue work first", () => {
  const now = new Date("2026-04-01T10:00:00.000Z");
  const todos = [
    todo(1, { due_date: "2026-04-01T09:59:59.999Z" }),
    todo(2, { due_date: "2026-04-01T10:00:00.000Z" }),
    todo(3, { due_date: "2026-04-01T10:00:00.001Z" }),
    todo(4, { due_date: null, created_at: "2020-01-01T00:00:00.000Z" }),
    todo(5, { completed: true, due_date: "2026-03-01T00:00:00.000Z" }),
  ];

  const sections = sectionTodos(todos, now);

  assert.deepEqual(sections.overdue.map(({ id }) => id), [1]);
  assert.deepEqual(sections.pending.map(({ id }) => id), [2, 3, 4]);
  assert.deepEqual(sections.completed.map(({ id }) => id), [5]);
});

test("sectionTodos orders completed todos by persisted completion time, not later edits", () => {
  const sections = sectionTodos(
    [
      todo(1, {
        completed: true,
        completed_at: "2026-01-02T00:00:00.000Z",
        updated_at: "2026-01-04T00:00:00.000Z",
      }),
      todo(2, {
        completed: true,
        completed_at: "2026-01-03T00:00:00.000Z",
        updated_at: "2026-01-03T00:00:00.000Z",
      }),
      todo(3, { completed: true, completed_at: null, updated_at: null }),
    ],
    new Date("2026-01-05T00:00:00.000Z"),
  );

  assert.deepEqual(sections.completed.map(({ id }) => id), [2, 1, 3]);
});
