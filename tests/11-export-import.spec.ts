import { test, expect, requestJSON } from "./helpers";
test("nested backup round-trip with remapped ids and invalid payload rollback", async ({
  page,
  account,
}) => {
  expect(account).toBeTruthy();
  const t = (
    await requestJSON(page, "todos", "POST", { title: 'Backup, "everything"' })
  ).body;
  await requestJSON(page, `todos/${t.id}/subtasks`, "POST", {
    title: "Nested step",
  });
  const tag = (await requestJSON(page, "tags", "POST", { name: "Backup" }))
    .body;
  await requestJSON(page, `todos/${t.id}/tags`, "POST", { tag_id: tag.id });
  const exported = (await requestJSON(page, "todos/export?format=json")).body;
  expect(exported.todos[0].id).toBeUndefined();
  expect(
    (await requestJSON(page, "todos/import", "POST", exported)).body.count,
  ).toBe(1);
  const todos = (await requestJSON(page, "todos")).body;
  expect(todos).toHaveLength(2);
  expect(todos[0].id).not.toBe(t.id);
  expect(todos[0].subtasks[0].todo_id).toBe(todos[0].id);
  expect(todos[0].tags[0].id).toBe(tag.id);
  expect(
    (
      await requestJSON(page, "todos/import", "POST", {
        version: 1,
        todos: [{ title: "Fine" }, { title: "Wrong", priority: "urgent" }],
      })
    ).status,
  ).toBe(400);
  expect((await requestJSON(page, "todos")).body).toHaveLength(2);
  await page.getByText("Data & account").click();
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export CSV", exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(
    /^todos-\d{4}-\d{2}-\d{2}\.csv$/,
  );
});
