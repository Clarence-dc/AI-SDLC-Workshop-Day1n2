import { test, expect, createTodo, requestJSON } from "./helpers";
test("create, cancel editing, edit, complete, reopen, delete and persist", async ({
  page,
  account,
}) => {
  expect(account).toBeTruthy();
  const card = await createTodo(page, "Prepare workshop");
  await card
    .getByRole("button", { name: "Edit Prepare workshop", exact: true })
    .click();
  await page
    .getByLabel("Task title", { exact: true })
    .last()
    .fill("Cancelled change");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(card.getByRole("heading")).toHaveText("Prepare workshop");
  await card
    .getByRole("button", { name: "Edit Prepare workshop", exact: true })
    .click();
  await page
    .getByLabel("Task title", { exact: true })
    .last()
    .fill("Prepare session");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByRole("heading", { name: "Prepare session", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Complete Prepare session", { exact: true }).check();
  await expect(
    page.getByRole("heading", { name: "Completed 1" }),
  ).toBeVisible();
  await page.getByLabel("Complete Prepare session", { exact: true }).uncheck();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Prepare session", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Delete Prepare session", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Prepare session", exact: true }),
  ).toHaveCount(0);
  expect((await requestJSON(page, "todos")).body).toHaveLength(0);
});
test("invalid titles are rejected server-side", async ({ page, account }) => {
  expect(account).toBeTruthy();
  expect(
    (await requestJSON(page, "todos", "POST", { title: "  " })).status,
  ).toBe(400);
});
