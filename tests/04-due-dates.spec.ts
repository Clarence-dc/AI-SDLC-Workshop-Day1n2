import { test, expect, requestJSON } from "./helpers";
import { addMinutes } from "../lib/timezone";
test("Singapore future due date, past date rejection, overdue grouping", async ({
  page,
  account,
}) => {
  expect(account).toBeTruthy();
  expect(
    (
      await requestJSON(page, "todos", "POST", {
        title: "Too soon",
        due_date: addMinutes(-1),
      })
    ).status,
  ).toBe(400);
  await requestJSON(page, "todos", "POST", {
    title: "Tomorrow in Singapore",
    due_date: addMinutes(1440),
  });
  await requestJSON(page, "todos/import", "POST", {
    version: 1,
    exported_at: addMinutes(0),
    todos: [
      {
        title: "Overdue task",
        due_date: "2020-01-01T10:00:00+08:00",
        completed: false,
        priority: "medium",
        is_recurring: false,
        recurrence_pattern: null,
        reminder_minutes: null,
        created_at: addMinutes(0),
        subtasks: [],
        tags: [],
      },
    ],
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Overdue 1" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pending 1" })).toBeVisible();
});
