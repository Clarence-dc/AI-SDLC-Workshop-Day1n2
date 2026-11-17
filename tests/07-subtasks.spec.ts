import { expect, request, test, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { Subtask, Todo } from "../lib/db";

type SessionFixture = {
  origin: string;
  token: string;
};

let session: SessionFixture;

async function createTodo(page: Page, title: string): Promise<Locator> {
  await page.locator("#todo-title").fill(title);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const card = page.locator("li").filter({ hasText: title }).first();
  await expect(card.getByRole("button", { name: "Show subtasks" })).toBeVisible();
  return card;
}

async function createApiContext() {
  return request.newContext({
    baseURL: session.origin,
    extraHTTPHeaders: {
      Cookie: `session=${session.token}`,
      Origin: session.origin,
    },
  });
}

async function getTodo(id: number): Promise<Todo> {
  const api = await createApiContext();
  try {
    const response = await api.get(`/api/todos/${id}`);
    expect(response.ok()).toBeTruthy();
    return await response.json() as Todo;
  } finally {
    await api.dispose();
  }
}

test.beforeEach(async ({ context, page }, testInfo) => {
  const sessionPath = testInfo.config.metadata.priorityE2eSessionFile;
  if (typeof sessionPath !== "string") {
    throw new Error("Playwright session fixture path is not configured.");
  }
  session = JSON.parse(readFileSync(sessionPath, "utf8")) as SessionFixture;
  const api = await createApiContext();
  try {
    const response = await api.get("/api/todos");
    expect(response.ok()).toBeTruthy();
    const todos = await response.json() as Todo[];
    for (const todo of todos) {
      const deleted = await api.delete(`/api/todos/${todo.id}`);
      expect(deleted.ok()).toBeTruthy();
    }
  } finally {
    await api.dispose();
  }
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

test("adds, toggles, deletes, persists and collapses an ordered checklist with immediate progress", async ({ page }) => {
  const card = await createTodo(page, "Checklist parent");
  await expect(card.getByRole("progressbar")).toHaveCount(0);
  await card.getByRole("button", { name: "Show subtasks" }).click();
  const input = card.getByLabel("Add subtask to Checklist parent");
  await expect(input).toBeVisible();

  let postCount = 0;
  await page.route("**/api/todos/*/subtasks", async (route) => {
    if (route.request().method() === "POST") postCount++;
    await route.continue();
  });
  await input.fill("   ");
  await input.press("Enter");
  await expect(card.getByRole("alert")).toHaveText("Subtask title is required.");
  expect(postCount).toBe(0);
  await page.unroute("**/api/todos/*/subtasks");

  let releaseFirstAdd!: () => void;
  let firstAddStarted!: () => void;
  const firstAddGate = new Promise<void>((resolve) => { releaseFirstAdd = resolve; });
  const firstAddRequest = new Promise<void>((resolve) => { firstAddStarted = resolve; });
  await page.route("**/api/todos/*/subtasks", async (route) => {
    if (route.request().method() === "POST" && route.request().postDataJSON().title === "First step") {
      firstAddStarted();
      await firstAddGate;
    }
    await route.continue();
  });

  try {
    const firstResponse = page.waitForResponse(
      (response) => response.request().method() === "POST" && response.url().includes("/subtasks"),
    );
    await input.fill("  First step  ");
    await input.press("Enter");
    await firstAddRequest;
    await expect(card.getByText("0/1 subtasks")).toBeVisible();
    await expect(card.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
    releaseFirstAdd();
    const first = await firstResponse;
    expect(first.status()).toBe(201);
  } finally {
    releaseFirstAdd();
    await page.unroute("**/api/todos/*/subtasks");
  }

  const secondResponse = page.waitForResponse(
    (response) => response.request().method() === "POST" && response.url().includes("/subtasks"),
  );
  await input.fill("Second step");
  await card.getByRole("button", { name: "Add", exact: true }).click();
  expect((await secondResponse).status()).toBe(201);
  await expect(card.getByText("0/2 subtasks")).toBeVisible();
  const secondCheckbox = card.getByRole("checkbox", { name: 'Mark subtask "Second step" as complete' });

  let releaseToggle!: () => void;
  let toggleStarted!: () => void;
  const toggleGate = new Promise<void>((resolve) => { releaseToggle = resolve; });
  const toggleRequest = new Promise<void>((resolve) => { toggleStarted = resolve; });
  await page.route("**/api/subtasks/*", async (route) => {
    if (route.request().method() === "PUT") {
      toggleStarted();
      await toggleGate;
    }
    await route.continue();
  });
  try {
    const toggleResponse = page.waitForResponse(
      (response) => response.request().method() === "PUT" && response.url().includes("/api/subtasks/"),
    );
    await secondCheckbox.click();
    await toggleRequest;
    await expect(card.getByText("1/2 subtasks")).toBeVisible();
    await expect(card.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
    await expect(card.getByRole("progressbar").locator("div")).toHaveClass(/bg-blue-500/);
    releaseToggle();
    expect((await toggleResponse).ok()).toBeTruthy();
  } finally {
    releaseToggle();
    await page.unroute("**/api/subtasks/*");
  }

  await card.getByRole("checkbox", { name: 'Mark subtask "First step" as complete' }).click();
  await expect(card.getByText("2/2 subtasks")).toBeVisible();
  await expect(card.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  await expect(card.getByRole("progressbar").locator("div")).toHaveClass(/bg-green-500/);

  const api = await createApiContext();
  let firstSubtask: Subtask;
  let secondSubtask: Subtask;
  try {
    const parentResponse = await api.get("/api/todos");
    const todos = await parentResponse.json() as Todo[];
    const persistedParent = todos.find((todo) => todo.title === "Checklist parent");
    expect(persistedParent).toBeDefined();
    [firstSubtask, secondSubtask] = persistedParent!.subtasks!;
    expect([firstSubtask.position, secondSubtask.position]).toEqual([0, 1]);
  } finally {
    await api.dispose();
  }

  const deleteResponse = page.waitForResponse(
    (response) => response.request().method() === "DELETE"
      && new URL(response.url()).pathname === `/api/subtasks/${firstSubtask.id}`,
  );
  await card.getByRole("button", { name: 'Delete subtask "First step"' }).click();
  expect((await deleteResponse).ok()).toBeTruthy();
  await expect(card.getByText("1/1 subtasks")).toBeVisible();
  await expect(card.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  await expect(card.getByRole("progressbar").locator("div")).toHaveClass(/bg-green-500/);

  const appendResponse = page.waitForResponse(
    (response) => response.request().method() === "POST" && response.url().includes("/subtasks"),
  );
  await input.fill("Third step");
  await card.getByRole("button", { name: "Add", exact: true }).click();
  expect((await appendResponse).status()).toBe(201);
  await expect(card.getByText("1/2 subtasks")).toBeVisible();
  await card.getByRole("button", { name: "Hide subtasks" }).click();
  await expect(card.getByRole("progressbar")).toBeVisible();
  await expect(card.getByText("1/2 subtasks")).toBeVisible();
  await expect(card.getByRole("list", { name: "Checklist parent subtasks" })).toBeHidden();

  const loaded = await getTodo(firstSubtask.todo_id);
  expect(loaded.subtasks?.map(({ title, position }) => ({ title, position }))).toEqual([
    { title: "Second step", position: secondSubtask.position },
    { title: "Third step", position: 2 },
  ]);
});

test("subtasks persist after reload and remain independent of parent completion; parent deletion cascades", async ({ page }) => {
  const card = await createTodo(page, "Independent checklist");
  const parentCompletion = page.waitForResponse(
    (response) => response.request().method() === "PUT"
      && new URL(response.url()).pathname.startsWith("/api/todos/"),
  );
  await card.getByRole("checkbox", { name: 'Mark "Independent checklist" as complete' }).click();
  expect((await parentCompletion).ok()).toBeTruthy();
  const todosApi = await createApiContext();
  let parent: Todo | undefined;
  try {
    const todosResponse = await todosApi.get("/api/todos");
    expect(todosResponse.ok()).toBeTruthy();
    parent = (await todosResponse.json() as Todo[])
      .find((todo) => todo.title === "Independent checklist");
  } finally {
    await todosApi.dispose();
  }
  expect(parent).toBeDefined();
  const completionTime = parent!.completed_at;
  expect(completionTime).toBeTruthy();

  await card.getByRole("button", { name: "Show subtasks" }).click();
  const input = card.getByLabel("Add subtask to Independent checklist");
  const createResponse = page.waitForResponse(
    (response) => response.request().method() === "POST" && response.url().includes("/subtasks"),
  );
  await input.fill("Independent step");
  await input.press("Enter");
  expect((await createResponse).status()).toBe(201);
  await expect(card.getByText("0/1 subtasks")).toBeVisible();

  await card.getByRole("checkbox", { name: 'Mark subtask "Independent step" as complete' }).click();
  await expect(card.getByText("1/1 subtasks")).toBeVisible();
  await expect(card.getByRole("checkbox", { name: 'Mark "Independent checklist" as incomplete' })).toBeChecked();
  const completedParent = await getTodo(parent!.id);
  expect(completedParent.completed_at).toBe(completionTime);
  expect(completedParent.subtasks?.[0].completed).toBe(true);

  const listResponse = page.waitForResponse(
    (response) => response.request().method() === "GET"
      && new URL(response.url()).pathname === "/api/todos",
  );
  await page.reload();
  expect((await listResponse).ok()).toBeTruthy();
  const rehydratedCard = page.locator("li").filter({ hasText: "Independent checklist" }).first();
  await expect(rehydratedCard.getByRole("checkbox", { name: 'Mark "Independent checklist" as incomplete' })).toBeChecked();
  await expect(rehydratedCard.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  await expect(rehydratedCard.getByText("1/1 subtasks")).toBeVisible();

  const deleteResponse = page.waitForResponse(
    (response) => response.request().method() === "DELETE"
      && new URL(response.url()).pathname === `/api/todos/${parent!.id}`,
  );
  await rehydratedCard.getByRole("button", { name: "Delete" }).click();
  expect((await deleteResponse).ok()).toBeTruthy();
  await expect(page.getByText("Independent checklist", { exact: true })).toHaveCount(0);
  const deletedParent = await (await page.request.get(`/api/todos/${parent!.id}`)).json();
  expect(deletedParent).toEqual({ error: "Todo not found" });
});
