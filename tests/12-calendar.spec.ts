import { test, expect, requestJSON } from "./helpers";
import { addMinutes, singaporeDay } from "../lib/timezone";
test("responsive workspace and dark calendar stay within the viewport", async ({
  page,
  account,
}) => {
  expect(account).toBeTruthy();
  for (const [title, priority] of [
    ["Prepare the workshop", "high"],
    ["Book a little time to read", "medium"],
    ["Plan next week", "low"],
  ])
    await requestJSON(page, "todos", "POST", {
      title,
      priority,
      due_date: addMinutes(1440),
    });
  await page.reload();
  await expect(page.getByTestId("todo-card")).toHaveCount(3);
  await page.screenshot({
    path: "test-results/workspace-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/workspace-mobile.png",
    fullPage: true,
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/calendar");
  await expect(page.locator(".calendar-cell").first()).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/calendar-mobile-dark.png",
    fullPage: true,
  });
});
test("calendar date placement, modal, month navigation and invalid URL fallback", async ({
  page,
  account,
}) => {
  expect(account).toBeTruthy();
  const due = addMinutes(1440),
    date = singaporeDay(due);
  await requestJSON(page, "todos", "POST", {
    title: "Calendar task",
    due_date: due,
    priority: "high",
  });
  await page.goto(`/calendar?month=${date.slice(0, 7)}`);
  await expect(
    page.getByRole("button", { name: date, exact: true }),
  ).toContainText("Calendar task");
  await page.getByRole("button", { name: date, exact: true }).click();
  await expect(page.locator("dialog")).toContainText("Calendar task");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Next month" }).click();
  await expect(page).toHaveURL(/month=/);
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp(`month=${singaporeDay().slice(0, 7)}`),
  );
  await page.goto("/calendar?month=2026-13");
  await expect(page.locator(".calendar-cell").first()).toBeVisible();
  expect([35, 42]).toContain(await page.locator(".calendar-cell").count());
});
