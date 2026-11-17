import { mkdir } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { virtualAuthenticator, register, requestJSON } from "../tests/helpers";
import { addMinutes, singaporeDay } from "../lib/timezone";

// Run against a local dev server. Uses an isolated demo account with a virtual passkey.
await mkdir("artifacts/previews", { recursive: true });
const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    baseURL: "http://localhost:3000",
    viewport: { width: 1400, height: 1000 },
    timezoneId: "Asia/Singapore",
  });
  const page = await context.newPage();
  await virtualAuthenticator(page);
  await register(page);
  async function call(path: string, method = "GET", body?: unknown) {
    const r = await requestJSON(page, path, method, body);
    if (r.status !== 200) throw new Error(`${path}: ${JSON.stringify(r.body)}`);
    return r.body;
  }
  const work = await call("tags", "POST", { name: "Work", color: "#365f47" });
  const personal = await call("tags", "POST", {
    name: "Personal",
    color: "#7853a0",
  });
  const first = await call("todos", "POST", {
    title: "Prepare the workshop",
    priority: "high",
    due_date: addMinutes(180),
    reminder_minutes: 30,
  });
  await call(`todos/${first.id}/tags`, "POST", { tag_id: work.id });
  for (const [title, completed] of [
    ["Outline the session", true],
    ["Prepare the exercises", true],
    ["Send the joining details", false],
  ] as const) {
    const s = await call(`todos/${first.id}/subtasks`, "POST", { title });
    if (completed) await call(`subtasks/${s.id}`, "PUT", { completed: true });
  }
  await call("todos", "POST", {
    title: "Make space for a weekly review",
    priority: "medium",
    due_date: addMinutes(1440),
    is_recurring: true,
    recurrence_pattern: "weekly",
  });
  const read = await call("todos", "POST", {
    title: "Read a chapter with a cup of tea",
    priority: "low",
  });
  await call(`todos/${read.id}/tags`, "POST", { tag_id: personal.id });
  const finished = await call("todos", "POST", {
    title: "Set an intention for the day",
  });
  await call(`todos/${finished.id}`, "PUT", { completed: true });
  await call("templates", "POST", {
    name: "Workshop checklist",
    title_template: "Prepare the workshop",
    category: "Work",
    priority: "high",
    due_date_offset_minutes: 1440,
    subtasks_json: JSON.stringify([
      { title: "Outline the session", position: 0 },
      { title: "Prepare the exercises", position: 1 },
      { title: "Send the joining details", position: 2 },
    ]),
  });
  await page.reload();
  await expect(page.getByTestId("todo-card")).toHaveCount(4);
  const card = page.getByTestId("todo-card").filter({
    has: page.getByRole("heading", {
      name: "Prepare the workshop",
      exact: true,
    }),
  });
  await card.getByRole("button", { name: "Subtasks", exact: true }).click();
  await page.screenshot({
    path: "artifacts/previews/01-workspace.png",
    fullPage: true,
  });
  process.stdout.write("Ready: artifacts/previews/01-workspace.png\n");
  await page.getByRole("button", { name: "Manage Tags", exact: true }).click();
  await page.screenshot({
    path: "artifacts/previews/02-tags.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: /Templates 1/ }).click();
  await page.screenshot({
    path: "artifacts/previews/03-templates.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Advanced", exact: false }).click();
  await page.getByLabel("Filter priority").selectOption("high");
  await expect(page.getByTestId("todo-card")).toHaveCount(1);
  await page.screenshot({
    path: "artifacts/previews/04-filters.png",
    fullPage: true,
  });
  await page.goto(`/calendar?month=${singaporeDay().slice(0, 7)}`);
  await expect(page.locator(".calendar-cell").first()).toBeVisible();
  await expect(
    page.locator(".calendar-task").filter({ hasText: "Prepare the workshop" }),
  ).toBeVisible();
  await page.screenshot({
    path: "artifacts/previews/05-calendar.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByTestId("todo-card")).toHaveCount(4);
  await page.screenshot({
    path: "artifacts/previews/06-mobile.png",
    fullPage: true,
  });
  process.stdout.write(
    "Ready: tags, templates, filters, calendar and mobile previews.\n",
  );
} finally {
  await browser.close();
}
