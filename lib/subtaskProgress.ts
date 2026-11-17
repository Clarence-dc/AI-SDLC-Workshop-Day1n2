import type { Subtask } from "./db";

export interface SubtaskProgress {
  completed: number;
  total: number;
  percent: number;
}

export function calculateProgress(subtasks: readonly Subtask[]): SubtaskProgress {
  const total = subtasks.length;
  const completed = subtasks.reduce((count, subtask) => count + Number(subtask.completed), 0);
  return { completed, total, percent: total === 0 ? 0 : Math.round((completed / total) * 100) };
}
