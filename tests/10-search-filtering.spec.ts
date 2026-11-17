import { test, expect, createTodo, addSubtask } from "./helpers";
test("subtask search, combined filters, clear and persistent presets", async ({
  page,
  account,
}) => {
  expect(account).toBeTruthy();
  await createTodo(page, "Plan workshop");
  await addSubtask(page, "Plan workshop", "Invite speakers");
  await createTodo(page, "Buy groceries");
  await page.getByLabel("Search tasks", { exact: true }).fill("SPEAK");
  await expect(page.getByTestId("todo-card")).toHaveCount(1);
  await expect(
    page.getByRole("heading", { name: "Plan workshop", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save Filter", exact: true }).click();
  await page.getByLabel("Preset name").fill("Speakers");
  await page.getByRole("button", { name: "Save preset", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "Speakers", exact: true }).click();
  await expect(page.getByTestId("todo-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Clear All", exact: true }).click();
  await expect(page.getByTestId("todo-card")).toHaveCount(2);
  await page.getByRole("button", { name: "Delete preset Speakers" }).click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Speakers", exact: true }),
  ).toHaveCount(0);
});
