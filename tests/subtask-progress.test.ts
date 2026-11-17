import assert from "node:assert/strict";
import { test } from "node:test";
import type { Subtask } from "../lib/db";
import { calculateProgress } from "../lib/subtaskProgress";

function subtasks(completed: number, total: number): Subtask[] {
  return Array.from({ length: total }, (_, index) => ({
    id: index + 1,
    todo_id: 1,
    title: `Step ${index + 1}`,
    completed: index < completed,
    position: index,
    created_at: "2030-01-01T00:00:00.000Z",
  }));
}

test("calculateProgress covers empty, incomplete, rounded, and complete checklists", () => {
  assert.deepEqual(calculateProgress([]), { completed: 0, total: 0, percent: 0 });
  assert.deepEqual(calculateProgress(subtasks(0, 7)), { completed: 0, total: 7, percent: 0 });
  assert.deepEqual(calculateProgress(subtasks(3, 7)), { completed: 3, total: 7, percent: 43 });
  assert.deepEqual(calculateProgress(subtasks(1, 3)), { completed: 1, total: 3, percent: 33 });
  assert.deepEqual(calculateProgress(subtasks(2, 3)), { completed: 2, total: 3, percent: 67 });
  assert.deepEqual(calculateProgress(subtasks(7, 7)), { completed: 7, total: 7, percent: 100 });
});
