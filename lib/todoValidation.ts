import type { Priority, RecurrencePattern, Todo, UpdateTodoInput } from "./db";
import { getSingaporeNow, normalizeTimestamp } from "./timezone";

export class TodoValidationError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

const fields = new Set([
  "title", "due_date", "priority", "is_recurring", "recurrence_pattern",
  "reminder_minutes", "tag_ids", "completed",
]);
const patterns: RecurrencePattern[] = ["daily", "weekly", "monthly", "yearly"];
const priorities: Priority[] = ["high", "medium", "low"];
const reminderOffsets = [15, 30, 60, 120, 1440, 2880, 10080];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateTodoInput(
  input: unknown, existing?: Todo, now = getSingaporeNow().getTime(),
): UpdateTodoInput {
  if (!isRecord(input)) {
    throw new TodoValidationError("JSON object required");
  }
  const body = input;
  for (const key of Object.keys(body)) {
    if (!fields.has(key) || (!existing && key === "completed")) {
      throw new TodoValidationError(`Unsupported field: ${key}`);
    }
  }
  const result: UpdateTodoInput = {};
  if (body.title !== undefined || !existing) {
    if (typeof body.title !== "string" || !body.title.trim()) {
      throw new TodoValidationError(existing ? "Title cannot be empty" : "Title is required");
    }
    result.title = body.title.trim();
  }
  if (body.priority !== undefined) {
    if (!priorities.some((priority) => priority === body.priority)) {
      throw new TodoValidationError("Priority must be 'high', 'medium', or 'low'");
    }
    result.priority = body.priority as Priority;
  }
  if (body.due_date !== undefined) {
    if (body.due_date === null) result.due_date = null;
    else {
      const normalized = typeof body.due_date === "string" ? normalizeTimestamp(body.due_date) : null;
      if (!normalized) throw new TodoValidationError("Due date must be a valid ISO timestamp with a timezone");
      if (normalized !== existing?.due_date && Date.parse(normalized) < now + 60_000) {
        throw new TodoValidationError("Due date must be at least 1 minute in the future");
      }
      result.due_date = normalized;
    }
  }
  for (const key of ["completed", "is_recurring"] as const) {
    if (body[key] !== undefined) {
      if (typeof body[key] !== "boolean") throw new TodoValidationError(`${key} must be a boolean`);
      result[key] = body[key];
    }
  }
  if (body.recurrence_pattern !== undefined) {
    if (body.recurrence_pattern !== null && !patterns.some((pattern) => pattern === body.recurrence_pattern)) {
      throw new TodoValidationError("Invalid recurrence pattern");
    }
    result.recurrence_pattern = body.recurrence_pattern as RecurrencePattern | null;
  }
  if (body.reminder_minutes !== undefined) {
    if (body.reminder_minutes !== null
      && !reminderOffsets.some((offset) => offset === body.reminder_minutes)) {
      throw new TodoValidationError("Invalid reminder offset");
    }
    result.reminder_minutes = body.reminder_minutes as number | null;
  }
  if (body.tag_ids !== undefined) {
    if (!Array.isArray(body.tag_ids)
      || !body.tag_ids.every((id: unknown) => typeof id === "number" && Number.isSafeInteger(id) && id > 0)) {
      throw new TodoValidationError("tag_ids must contain positive integer IDs");
    }
    result.tag_ids = [...new Set<number>(body.tag_ids)];
  }
  const merged = { ...existing, ...result };
  if (merged.is_recurring && (!merged.due_date || !merged.recurrence_pattern)) {
    throw new TodoValidationError("Recurring todos require a due date and recurrence pattern");
  }
  return result;
}
