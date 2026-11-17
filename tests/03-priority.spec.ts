import { expect, request, test, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { Todo } from "../lib/db";

type SessionFixture = {
  origin: string;
  token: string;
};

let session: SessionFixture;

const priorities = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
] as const;

async function resetTodos(): Promise<void> {
  const api = await request.newContext({
    baseURL: session.origin,
    extraHTTPHeaders: {
      Cookie: `session=${session.token}`,
      Origin: session.origin,
    },
  });
  try {
    const response = await api.get("/api/todos");
    expect(response.ok()).toBeTruthy();
    const body: unknown = await response.json();
    const todos = Array.isArray(body) ? body : (body as { todos?: unknown[] }).todos;
    expect(Array.isArray(todos)).toBeTruthy();
    for (const todo of todos as { id: number }[]) {
      const deleted = await api.delete(`/api/todos/${todo.id}`);
      expect(deleted.ok()).toBeTruthy();
    }
  } finally {
    await api.dispose();
  }
}

async function createTodo(
  page: Page,
  title: string,
  priority?: (typeof priorities)[number]["value"],
): Promise<Locator> {
  if (priority) {
    await page.locator("#todo-priority").selectOption(priority);
  }
  await page.locator("#todo-title").fill(title);
  await page.getByRole("button", { name: "Add", exact: true }).click();

  const item = page.locator("li").filter({ hasText: title });
  const label = priorities.find((choice) => choice.value === (priority ?? "medium"))?.label;
  if (!label) throw new Error(`Unknown priority: ${priority}`);
  await expect(item.getByText(label, { exact: true })).toBeVisible();
  return item;
}

test.beforeEach(async ({ context, page }, testInfo) => {
  const sessionPath = testInfo.config.metadata.priorityE2eSessionFile;
  if (typeof sessionPath !== "string") {
    throw new Error("Priority Playwright session fixture path is not configured.");
  }
  session = JSON.parse(readFileSync(sessionPath, "utf8")) as SessionFixture;
  await resetTodos();
  await context.addCookies([{
    name: "session",
    value: session.token,
    url: session.origin,
    httpOnly: true,
    sameSite: "Lax",
  }]);
  await page.goto("/");
  await expect(page.locator("#todo-title")).toBeVisible();
});

test("creates each priority, defaults to Medium, and sorts priority groups", async ({ page }) => {
  const high = await createTodo(page, "Priority High", "high");
  const medium = await createTodo(page, "Priority Medium", "medium");
  const low = await createTodo(page, "Priority Low", "low");
  const defaultMedium = await createTodo(page, "Priority Default");

  await expect(high.getByText("High", { exact: true })).toBeVisible();
  await expect(medium.getByText("Medium", { exact: true })).toBeVisible();
  await expect(low.getByText("Low", { exact: true })).toBeVisible();
  await expect(defaultMedium.getByText("Medium", { exact: true })).toBeVisible();

  const titles = await page.locator("#pending-heading + ul li p").allTextContents();
  expect(titles[0]).toBe("Priority High");
  expect(titles.at(-1)).toBe("Priority Low");
  expect(titles.slice(1, 3).sort()).toEqual(["Priority Default", "Priority Medium"]);
});

test("shows the selected priority immediately while creating", async ({ page }) => {
  let releaseCreate!: () => void;
  let markCreateStarted!: () => void;
  const createGate = new Promise<void>((resolve) => { releaseCreate = resolve; });
  const createStarted = new Promise<void>((resolve) => { markCreateStarted = resolve; });
  await page.route("**/api/todos", async (route) => {
    if (route.request().method() === "POST") {
      markCreateStarted();
      await createGate;
    }
    await route.continue();
  });

  try {
    const createResponse = page.waitForResponse(
      (response) => response.request().method() === "POST" && response.url().endsWith("/api/todos"),
    );
    await page.locator("#todo-priority").selectOption("high");
    await page.locator("#todo-title").fill("Immediate High");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await createStarted;
    await expect(
      page.locator("li").filter({ hasText: "Immediate High" }).getByText("High", { exact: true }),
    ).toBeVisible();
    releaseCreate();
    expect((await createResponse).ok()).toBeTruthy();
  } finally {
    releaseCreate();
    await page.unroute("**/api/todos");
  }
});

test("filters immediately when an edited todo leaves the selected priority", async ({ page }) => {
  await createTodo(page, "Editable Low", "low");
  await createTodo(page, "Visible Medium", "medium");
  await page.locator("#priority-filter").selectOption("low");

  let releaseUpdate!: () => void;
  let markUpdateStarted!: () => void;
  const updateGate = new Promise<void>((resolve) => { releaseUpdate = resolve; });
  const updateStarted = new Promise<void>((resolve) => { markUpdateStarted = resolve; });
  await page.route("**/api/todos/*", async (route) => {
    if (route.request().method() === "PUT") {
      markUpdateStarted();
      await updateGate;
    }
    await route.continue();
  });

  try {
    const updateResponse = page.waitForResponse(
      (response) => response.request().method() === "PUT" && response.url().includes("/api/todos/"),
    );
    await page.locator("li").filter({ hasText: "Editable Low" }).getByRole("button", { name: "Edit" }).click();
    await page.locator("#edit-todo-priority").selectOption("high");
    await page.getByRole("button", { name: "Update" }).click();
    await updateStarted;
    await expect(page.getByText("No todos match this priority.", { exact: true })).toBeVisible();
    releaseUpdate();
    expect((await updateResponse).ok()).toBeTruthy();
  } finally {
    releaseUpdate();
    await page.unroute("**/api/todos/*");
  }

  await page.locator("#priority-filter").selectOption("high");
  await expect(page.getByText("Editable Low", { exact: true })).toBeVisible();
  await expect(page.getByText("Visible Medium", { exact: true })).toHaveCount(0);

  await page.locator("#priority-filter").selectOption("all");
  const titles = await page.locator("#pending-heading + ul li p").allTextContents();
  expect(titles).toEqual(["Editable Low", "Visible Medium"]);
});

test("completed order survives editing and server hydration after reload; recompletion moves newest", async ({ page }) => {
  const completedTitles = page.locator("#completed-heading + ul li p");

  async function toggle(title: string, completed: boolean): Promise<Todo> {
    const responsePromise = page.waitForResponse(
      (response) => response.request().method() === "PUT" && response.url().includes("/api/todos/"),
    );
    // Clicking avoids re-resolving a checkbox whose label changes with its state.
    await page.getByRole("checkbox", {
      name: `Mark "${title}" as ${completed ? "complete" : "incomplete"}`,
      exact: true,
    }).click();
    const response = await responsePromise;
    expect(response.ok()).toBeTruthy();
    const { todo }: { todo: Todo } = await response.json();
    expect(todo.completed).toBe(completed);
    await expect(page.getByRole("checkbox", {
      name: `Mark "${title}" as ${completed ? "incomplete" : "complete"}`,
      exact: true,
    })).toBeEnabled();
    return todo;
  }

  async function reloadAndRead(): Promise<Todo[]> {
    const listResponse = page.waitForResponse(
      (response) => response.request().method() === "GET"
        && new URL(response.url()).pathname === "/api/todos",
    );
    await page.reload();
    const response = await listResponse;
    expect(response.ok()).toBeTruthy();
    const todos: Todo[] = await response.json();
    return todos;
  }

  await createTodo(page, "Completion A", "low");
  await createTodo(page, "Completion B", "medium");
  const a = await toggle("Completion A", true);
  const b = await toggle("Completion B", true);
  expect(typeof a.completed_at).toBe("string");
  expect(typeof b.completed_at).toBe("string");
  expect(Date.parse(b.completed_at!)).toBeGreaterThan(Date.parse(a.completed_at!));
  await expect(completedTitles).toHaveText(["Completion B", "Completion A"]);

  await page.locator("li").filter({ hasText: "Completion A" }).getByRole("button", { name: "Edit" }).click();
  await page.locator("#edit-todo-title").fill("Completion A edited");
  await page.locator("#edit-todo-priority").selectOption("high");
  const editResponse = page.waitForResponse(
    (response) => response.request().method() === "PUT"
      && new URL(response.url()).pathname === `/api/todos/${a.id}`,
  );
  await page.getByRole("button", { name: "Update" }).click();
  await expect(completedTitles).toHaveText(["Completion B", "Completion A edited"]);
  const saved = await editResponse;
  expect(saved.ok()).toBeTruthy();
  const { todo: edited }: { todo: Todo } = await saved.json();
  expect(edited.completed_at).toBe(a.completed_at);
  expect(Date.parse(edited.updated_at!)).toBeGreaterThan(Date.parse(b.completed_at!));
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(completedTitles).toHaveText(["Completion B", "Completion A edited"]);

  const reloaded = await reloadAndRead();
  expect(reloaded.find(({ id }) => id === a.id)?.completed_at).toBe(a.completed_at);
  expect(reloaded.find(({ id }) => id === b.id)?.completed_at).toBe(b.completed_at);
  await expect(completedTitles).toHaveText(["Completion B", "Completion A edited"]);

  const uncompleted = await toggle("Completion A edited", false);
  expect(uncompleted.completed_at).toBeNull();
  await expect(completedTitles).toHaveText(["Completion B"]);
  const recompleted = await toggle("Completion A edited", true);
  expect(Date.parse(recompleted.completed_at!)).toBeGreaterThan(Date.parse(b.completed_at!));
  await expect(completedTitles).toHaveText(["Completion A edited", "Completion B"]);
  const afterRecompletion = await reloadAndRead();
  expect(afterRecompletion.find(({ id }) => id === a.id)?.completed_at).toBe(recompleted.completed_at);
  await expect(completedTitles).toHaveText(["Completion A edited", "Completion B"]);
});

test("priority badges meet text contrast in light and dark color schemes", async ({ page }) => {
  const badges = new Map<string, Locator>();
  for (const priority of priorities) {
    const item = await createTodo(page, `Contrast ${priority.label}`, priority.value);
    badges.set(priority.label, item.getByText(priority.label, { exact: true }));
  }

  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    for (const { label } of priorities) {
      const contrast = await badges.get(label)!.evaluate((element) => {
        const style = getComputedStyle(element);
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas 2D context is unavailable.");
        const rgb = (color: string) => {
          context.fillStyle = color;
          context.fillRect(0, 0, 1, 1);
          const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
          return [red, green, blue].map((channel) => {
            const value = channel / 255;
            return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
          });
        };
        const luminance = (channels: number[]) =>
          0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
        const [foreground, background] = [style.color, style.backgroundColor].map(rgb)
          .map(luminance)
          .sort((a, b) => b - a);
        return (foreground + 0.05) / (background + 0.05);
      });

      expect(contrast, `${colorScheme} ${label} badge contrast`).toBeGreaterThanOrEqual(4.5);
      console.log(`${colorScheme} ${label} badge contrast: ${contrast.toFixed(2)}:1`);
    }
  }
});
