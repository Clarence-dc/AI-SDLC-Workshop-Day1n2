import {
  test,
  expect,
  createTodo,
  addSubtask,
  createTemplate,
  requestJSON,
} from "./helpers";
test("save subtasks as template, use and delete independently", async ({
  page,
  account,
}) => {
  expect(account).toBeTruthy();
  await createTodo(page, "Release checklist");
  await addSubtask(page, "Release checklist", "Run checks");
  await createTemplate(page, "Release checklist", "Release routine");
  await page
    .getByLabel("Use a template")
    .selectOption({ label: "Release routine" });
  await expect(
    page.getByRole("heading", { name: "Release checklist", exact: true }),
  ).toHaveCount(2);
  const templates = (await requestJSON(page, "templates")).body;
  const todos = (await requestJSON(page, "todos")).body;
  expect(todos[0].subtasks[0].title).toBe("Run checks");
  expect(todos[0].subtasks[0].completed).toBe(false);
  await requestJSON(page, `templates/${templates[0].id}`, "DELETE");
  expect((await requestJSON(page, "todos")).body).toHaveLength(2);
});
