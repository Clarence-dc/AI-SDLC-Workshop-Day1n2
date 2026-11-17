import { test, expect, requestJSON } from "./helpers";
import { addMinutes, calculateNextDueDate } from "../lib/timezone";
test("recurrence requires due date, inherits metadata and spawns only once", async ({
  page,
  account,
}) => {
  expect(account).toBeTruthy();
  expect(
    (
      await requestJSON(page, "todos", "POST", {
        title: "Bad",
        is_recurring: true,
        recurrence_pattern: "daily",
      })
    ).status,
  ).toBe(400);
  const original = (
    await requestJSON(page, "todos", "POST", {
      title: "Weekly review",
      due_date: addMinutes(1440),
      priority: "high",
      is_recurring: true,
      recurrence_pattern: "weekly",
      reminder_minutes: 15,
    })
  ).body;
  const tag = (await requestJSON(page, "tags", "POST", { name: "Routine" }))
    .body;
  await requestJSON(page, `todos/${original.id}/tags`, "POST", {
    tag_id: tag.id,
  });
  await requestJSON(page, `todos/${original.id}`, "PUT", { completed: true });
  await requestJSON(page, `todos/${original.id}`, "PUT", { completed: true });
  const todos = (await requestJSON(page, "todos")).body;
  expect(todos).toHaveLength(2);
  const next = todos.find((t: { completed: boolean }) => !t.completed);
  expect(next.due_date).toBe(calculateNextDueDate(original.due_date, "weekly"));
  expect(next.tags[0].name).toBe("Routine");
  expect(next.reminder_minutes).toBe(15);
  await page.reload();
  await expect(page.getByText("↻ weekly")).toHaveCount(2);
});
