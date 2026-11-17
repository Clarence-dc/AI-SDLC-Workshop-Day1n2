import { z } from "zod";
import { getSingaporeNow, parseSingaporeDate, singaporeISO } from "./timezone";
export const titleSchema = z
  .string()
  .trim()
  .min(1, "Title cannot be empty")
  .max(500);
export const prioritySchema = z.enum(["high", "medium", "low"]);
export const patternSchema = z.enum(["daily", "weekly", "monthly", "yearly"]);
export const reminderSchema = z.union([
  z.literal(15),
  z.literal(30),
  z.literal(60),
  z.literal(120),
  z.literal(1440),
  z.literal(2880),
  z.literal(10080),
]);
const dateSchema = z.string().refine((v) => {
  const match =
    /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d)(?:\.\d{1,3})?)?(?:Z|([+-])(\d\d):(\d\d))?$/.exec(
      v,
    );
  if (!match) return false;
  const [, year, month, day, hour, minute, second, , offsetHour, offsetMinute] =
    match;
  const y = +year,
    m = +month,
    d = +day;
  const maxDay =
    m === 2
      ? y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)
        ? 29
        : 28
      : [4, 6, 9, 11].includes(m)
        ? 30
        : 31;
  return (
    y >= 1900 &&
    y <= 9998 &&
    m >= 1 &&
    m <= 12 &&
    d >= 1 &&
    d <= maxDay &&
    +hour < 24 &&
    +minute < 60 &&
    +(second || 0) < 60 &&
    +(offsetHour || 0) <= 14 &&
    +(offsetMinute || 0) < 60 &&
    Number.isFinite(parseSingaporeDate(v).getTime())
  );
}, "Invalid due date");
export const todoSchema = z.object({
  title: titleSchema,
  completed: z.boolean().default(false),
  due_date: dateSchema.nullable().default(null),
  priority: prioritySchema.default("medium"),
  is_recurring: z.boolean().default(false),
  recurrence_pattern: patternSchema.nullable().default(null),
  reminder_minutes: reminderSchema.nullable().default(null),
});
export type TodoInput = z.infer<typeof todoSchema>;
export function validateTodo(value: unknown, checkFuture = true): TodoInput {
  const data = todoSchema.parse(value);
  if (data.is_recurring && (!data.due_date || !data.recurrence_pattern))
    throw new Error(
      "Recurring todos require a due date and recurrence pattern",
    );
  if (data.reminder_minutes && !data.due_date)
    throw new Error("Reminders require a due date");
  if (
    checkFuture &&
    data.due_date &&
    parseSingaporeDate(data.due_date).getTime() <
      getSingaporeNow().getTime() + 60000
  )
    throw new Error(
      "Due date must be at least 1 minute in the future (Singapore time)",
    );
  return {
    ...data,
    due_date: data.due_date
      ? singaporeISO(parseSingaporeDate(data.due_date))
      : null,
    recurrence_pattern: data.is_recurring ? data.recurrence_pattern : null,
  };
}
export const tagSchema = z.object({
  name: z.string().trim().min(1).max(80),
  color: z
    .string()
    .regex(/^#[a-fA-F0-9]{6}$/)
    .default("#3B82F6"),
});
const templateSubtask = z.object({
  title: titleSchema,
  position: z.number().int().nonnegative(),
});
export const templateSchema = z
  .object({
    name: titleSchema,
    description: z.string().max(2000).nullable().default(null),
    category: z.string().max(100).nullable().default(null),
    title_template: titleSchema,
    priority: prioritySchema.default("medium"),
    is_recurring: z.boolean().default(false),
    recurrence_pattern: patternSchema.nullable().default(null),
    reminder_minutes: reminderSchema.nullable().default(null),
    due_date_offset_minutes: z
      .number()
      .int()
      .min(2)
      .max(5256000)
      .nullable()
      .default(null),
    subtasks_json: z.string().nullable().default(null),
  })
  .superRefine((v, ctx) => {
    if (
      v.is_recurring &&
      (!v.recurrence_pattern || v.due_date_offset_minutes === null)
    )
      ctx.addIssue({
        code: "custom",
        message: "Recurring templates require a pattern and due date offset",
      });
    if (v.reminder_minutes && v.due_date_offset_minutes === null)
      ctx.addIssue({
        code: "custom",
        message: "Reminder templates require a due date offset",
      });
    if (v.subtasks_json !== null) {
      try {
        z.array(templateSubtask).parse(JSON.parse(v.subtasks_json));
      } catch {
        ctx.addIssue({ code: "custom", message: "Invalid template subtasks" });
      }
    }
  });
export function parseTemplateSubtasks(value: string | null) {
  try {
    return z.array(templateSubtask).parse(JSON.parse(value || "[]"));
  } catch {
    return [];
  }
}
export const importSchema = z.object({
  version: z.literal(1),
  exported_at: z.string(),
  todos: z
    .array(
      todoSchema.extend({
        completed: z.boolean(),
        due_date: dateSchema.nullable(),
        priority: prioritySchema,
        is_recurring: z.boolean(),
        recurrence_pattern: patternSchema.nullable(),
        reminder_minutes: reminderSchema.nullable(),
        created_at: dateSchema,
        subtasks: z.array(templateSubtask.extend({ completed: z.boolean() })),
        tags: z.array(tagSchema),
      }),
    )
    .max(10000),
});
