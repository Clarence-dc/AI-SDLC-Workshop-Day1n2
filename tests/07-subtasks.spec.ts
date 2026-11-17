import { test, expect, createTodo, addSubtask, requestJSON } from "./helpers";
test("subtasks progress remains visible collapsed and cascades", async ({
  page,
  account,
}) => {
  expect(account).toBeTruthy();
  const card = await createTodo(page, "Pack bag");
  await addSubtask(page, "Pack bag", "Bring charger");
  await page
    .getByLabel("Complete subtask Bring charger", { exact: true })
    .check();
  await expect(card.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "100",
  );
  await card.getByRole("button", { name: "Subtasks", exact: true }).click();
  await expect(card.getByText("1/1 subtasks")).toBeVisible();
  const todos = (await requestJSON(page, "todos")).body;
  const subId = todos[0].subtasks[0].id;
  const deletion = page.waitForResponse(
    (r) => r.request().method() === "DELETE" && r.url().includes("/api/todos/"),
  );
  await page
    .getByRole("button", { name: "Delete Pack bag", exact: true })
    .click();
  expect((await deletion).ok()).toBe(true);
  expect(
    (await requestJSON(page, `subtasks/${subId}`, "PUT", { completed: false }))
      .status,
  ).toBe(404);
});
