import { test, expect, requestJSON } from "./helpers";
test("priority sort, filters, invalid enum and default", async ({
  page,
  account,
}) => {
  expect(account).toBeTruthy();
  for (const priority of ["low", "high", "medium"])
    await requestJSON(page, "todos", "POST", {
      title: `${priority} task`,
      priority,
    });
  await page.reload();
  await expect(page.getByTestId("todo-card").getByRole("heading")).toHaveText([
    "high task",
    "medium task",
    "low task",
  ]);
  await page.getByLabel("Filter priority").selectOption("high");
  await expect(page.getByTestId("todo-card")).toHaveCount(1);
  expect(
    (
      await requestJSON(page, "todos", "POST", {
        title: "Bad",
        priority: "urgent",
      })
    ).status,
  ).toBe(400);
  expect(
    (await requestJSON(page, "todos", "POST", { title: "Default" })).body
      .priority,
  ).toBe("medium");
});
