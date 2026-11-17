import { test, expect, createTodo, createTag, requestJSON } from "./helpers";
test("tag creation, attachment, edit propagation, filtering and delete", async ({
  page,
  account,
}) => {
  expect(account).toBeTruthy();
  await createTodo(page, "Plan trip");
  await createTag(page, "Travel");
  const t = (await requestJSON(page, "todos")).body[0],
    tag = (await requestJSON(page, "tags")).body[0];
  await requestJSON(page, `todos/${t.id}/tags`, "POST", { tag_id: tag.id });
  await requestJSON(page, `todos/${t.id}/tags`, "POST", { tag_id: tag.id });
  await requestJSON(page, `tags/${tag.id}`, "PUT", {
    name: "Adventure",
    color: "#993399",
  });
  await page.reload();
  await expect(
    page.getByTestId("todo-card").getByText("Adventure"),
  ).toBeVisible();
  await page.getByLabel("Filter tag").selectOption(String(tag.id));
  await expect(page.getByTestId("todo-card")).toHaveCount(1);
  expect(
    (await requestJSON(page, "tags", "POST", { name: "adventure" })).status,
  ).toBe(409);
  await requestJSON(page, `tags/${tag.id}`, "DELETE");
  expect((await requestJSON(page, "todos")).body[0].tags).toHaveLength(0);
});
