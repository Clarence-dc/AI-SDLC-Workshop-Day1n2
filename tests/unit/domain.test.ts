import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calculateNextDueDate,
  generateCalendarGrid,
  parseSingaporeDate,
  singaporeDay,
  calendarMonth,
  addMinutes,
} from "../../lib/timezone";
import {
  applyFilters,
  defaultFilters,
  sectionTodos,
  sortTodos,
  calculateProgress,
  toCSV,
} from "../../lib/todos";
import { validateTodo, parseTemplateSubtasks } from "../../lib/validation";
import type { Todo } from "../../lib/db";
const make = (id: number, patch: Partial<Todo> = {}): Todo => ({
  id,
  user_id: 1,
  title: `Task ${id}`,
  completed: false,
  due_date: null,
  priority: "medium",
  is_recurring: false,
  recurrence_pattern: null,
  reminder_minutes: null,
  last_notification_sent: null,
  created_at: "2026-01-01T10:00:00+08:00",
  updated_at: null,
  subtasks: [],
  tags: [],
  ...patch,
});
test("Singapore parsing is independent of host timezone", () => {
  assert.equal(
    parseSingaporeDate("2026-01-01T00:30").toISOString(),
    "2025-12-31T16:30:00.000Z",
  );
  assert.equal(singaporeDay("2026-01-01T18:00:00Z"), "2026-01-02");
});
for (const [from, pattern, to] of [
  ["2025-01-31T09:00", "monthly", "2025-02-28"],
  ["2024-01-31T09:00", "monthly", "2024-02-29"],
  ["2024-02-29T09:00", "yearly", "2025-02-28"],
  ["2025-12-31T09:00", "monthly", "2026-01-31"],
  ["2026-01-01T09:00", "daily", "2026-01-02"],
  ["2026-01-01T09:00", "weekly", "2026-01-08"],
] as const)
  test(`recurrence ${pattern}: ${from}`, () =>
    assert.equal(
      calculateNextDueDate(from, pattern),
      `${to}T09:00:00.000+08:00`,
    ));
test("calendar complete weeks, leap day, weekend flags and today", () => {
  for (const [year, month] of [
    [2026, 2],
    [2028, 2],
    [2026, 8],
  ]) {
    const g = generateCalendarGrid(year, month, "2028-02-29");
    assert.ok([35, 42].includes(g.length));
    assert.equal(g.length % 7, 0);
    assert.equal(g[0].isWeekend, true);
    assert.equal(g[1].isWeekend, false);
  }
  assert.ok(
    generateCalendarGrid(2028, 2).some(
      (c) => c.date === "2028-02-29" && c.isCurrentMonth,
    ),
  );
  assert.equal(
    generateCalendarGrid(2028, 2, "2028-02-29").filter((c) => c.isToday).length,
    1,
  );
  assert.equal(calendarMonth("2026-13"), singaporeDay().slice(0, 7));
});
test("sort priority, due date and newest creation without mutating", () => {
  const ts = [
    make(1, { priority: "low" }),
    make(2, { priority: "high" }),
    make(3, { priority: "high", due_date: "2026-01-01T10:00" }),
    make(4, {
      priority: "high",
      due_date: "2026-01-01T10:00",
      created_at: "2026-01-02T10:00",
    }),
  ];
  assert.deepEqual(
    sortTodos(ts).map((t) => t.id),
    [4, 3, 2, 1],
  );
  assert.equal(ts[0].id, 1);
});
test("section exact boundary and completed overdue", () => {
  const due = "2026-01-01T10:00";
  const ts = [
    make(1, { due_date: due }),
    make(2, { due_date: due, completed: true }),
    make(3),
  ];
  const at = sectionTodos(ts, parseSingaporeDate(due).getTime());
  assert.equal(at.Pending.length, 2);
  assert.equal(at.Overdue.length, 0);
  assert.equal(at.Completed.length, 1);
  assert.equal(
    sectionTodos(ts, parseSingaporeDate(due).getTime() + 1).Overdue.length,
    1,
  );
});
test("creation tie-break compares instants across imported timezone offsets", () => {
  const ts = [
    make(1, { created_at: "2026-01-01T10:00:00+08:00" }),
    make(2, { created_at: "2026-01-01T05:00:00Z" }),
  ];
  assert.deepEqual(
    sortTodos(ts).map((t) => t.id),
    [2, 1],
  );
});
test("filters search subtasks and combine all dimensions", () => {
  const ts = [
    make(1, {
      title: "Release",
      priority: "high",
      due_date: "2026-01-02T10:00",
      tags: [
        { id: 5, user_id: 1, name: "Work", color: "#000000", created_at: "" },
      ],
      subtasks: [
        {
          id: 1,
          todo_id: 1,
          title: "Invite speakers",
          completed: false,
          position: 0,
          created_at: "",
        },
      ],
    }),
    make(2),
  ];
  assert.equal(
    applyFilters(ts, {
      ...defaultFilters,
      search: "SPEAK",
      priority: "high",
      tagId: "5",
      completion: "incomplete",
      dueDateFrom: "2026-01-02",
      dueDateTo: "2026-01-02",
    }).length,
    1,
  );
  assert.equal(
    applyFilters(ts, {
      ...defaultFilters,
      dueDateFrom: "2027-01-01",
      dueDateTo: "2026-01-01",
    }).length,
    0,
  );
});
test("progress rounds and empty lists stay at zero", () => {
  assert.deepEqual(calculateProgress([]), {
    completed: 0,
    total: 0,
    percent: 0,
  });
  const s = Array.from({ length: 3 }, (_, i) => ({
    id: i,
    todo_id: 1,
    title: "Step",
    completed: i === 0,
    position: i,
    created_at: "",
  }));
  assert.equal(calculateProgress(s).percent, 33);
});
test("validation rejects impossible dates, invalid enums and recurrence without due date", () => {
  assert.throws(() => validateTodo({ title: " " }));
  assert.throws(() => validateTodo({ title: "x", priority: "urgent" }));
  assert.throws(() =>
    validateTodo({ title: "x", due_date: "2026-02-30T10:00" }, false),
  );
  assert.throws(() => validateTodo({ title: "x", is_recurring: true }));
  assert.throws(() => validateTodo({ title: "x", due_date: addMinutes(-1) }));
  assert.equal(
    validateTodo({ title: " x ", due_date: addMinutes(2) }).title,
    "x",
  );
});
test("template malformed subtasks fall back safely and CSV escapes", () => {
  assert.deepEqual(parseTemplateSubtasks("{broken"), []);
  assert.match(toCSV([make(1, { title: 'A,"B"\nC' })]), /"A,""B""\nC"/);
});
test("1000 todos filter within 100ms", () => {
  const start = performance.now();
  assert.equal(
    applyFilters(
      Array.from({ length: 1000 }, (_, i) => make(i)),
      { ...defaultFilters, search: "task" },
    ).length,
    1000,
  );
  assert.ok(performance.now() - start < 100);
});
