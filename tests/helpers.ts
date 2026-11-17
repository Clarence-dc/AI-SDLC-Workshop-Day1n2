import { test as base, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
export { expect };
export async function virtualAuthenticator(
  page: Page,
  transport: "internal" | "usb" = "internal",
) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send(
    "WebAuthn.addVirtualAuthenticator",
    {
      options: {
        protocol: "ctap2",
        transport,
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    },
  );
  return { cdp, authenticatorId };
}
export async function register(
  page: Page,
  username = `test_${randomUUID().slice(0, 12)}`,
) {
  await page.goto("/login");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByRole("button", { name: "Create an account" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("button", { name: "Add task" })).toBeEnabled();
  return username;
}
export async function login(page: Page, username: string) {
  await page.goto("/login");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByRole("button", { name: "Sign in with passkey" }).click();
  await expect(page).toHaveURL("/");
}
export async function createTodo(page: Page, title: string) {
  await page.getByLabel("Task title", { exact: true }).fill(title);
  await page.getByRole("button", { name: "Add task" }).click();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Add task" })).toBeEnabled();
  return page
    .getByTestId("todo-card")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
}
export async function createTag(page: Page, name: string) {
  await page.getByRole("button", { name: "Manage Tags", exact: true }).click();
  await page.getByLabel("Tag name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Create tag", exact: true }).click();
  await expect(
    page.locator("dialog .tag-pill").filter({ hasText: name }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
}
export async function addSubtask(page: Page, title: string, subtask: string) {
  const card = page
    .getByTestId("todo-card")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
  await card.getByRole("button", { name: "Subtasks", exact: true }).click();
  await page
    .getByLabel(`New subtask for ${title}`, { exact: true })
    .fill(subtask);
  await card.getByRole("button", { name: "Add", exact: true }).click();
  await expect(card.getByText(subtask, { exact: true })).toBeVisible();
}
export async function createTemplate(page: Page, title: string, name: string) {
  await page
    .getByRole("button", { name: `Save ${title} as template`, exact: true })
    .click();
  await page.getByLabel("Template name", { exact: true }).fill(name);
  await page
    .getByRole("button", { name: "Save template", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Template saved");
}
export async function requestJSON(
  page: Page,
  path: string,
  method = "GET",
  body?: unknown,
) {
  return page.evaluate(
    async ({ path, method, body }) => {
      const response = await fetch(`/api/${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    },
    { path, method, body },
  );
}
export const test = base.extend<{ account: string }>({
  account: async ({ page }, provide) => {
    await virtualAuthenticator(page);
    const username = await register(page);
    await provide(username);
  },
});
