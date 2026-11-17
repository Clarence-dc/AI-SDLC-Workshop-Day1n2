import { test, expect, requestJSON } from "./helpers";
import { addMinutes } from "../lib/timezone";
test("browser delivers a notification once when permission is granted", async ({
  page,
  account,
}) => {
  expect(account).toBeTruthy();
  await page.context().grantPermissions(["notifications"]);
  await page.addInitScript(() => {
    const messages: string[] = [];
    Object.defineProperty(window, "notificationMessages", { value: messages });
    class FakeNotification {
      static permission = "granted";
      constructor(_title: string, options?: NotificationOptions) {
        messages.push(options?.body || "");
      }
    }
    Object.defineProperty(window, "Notification", {
      value: FakeNotification,
      configurable: true,
    });
  });
  await requestJSON(page, "todos", "POST", {
    title: "Browser reminder",
    due_date: addMinutes(5),
    reminder_minutes: 15,
  });
  await page.reload();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { notificationMessages: string[] })
            .notificationMessages,
      ),
    )
    .toEqual(["Browser reminder"]);
  expect(
    (await requestJSON(page, "notifications/check")).body.todos,
  ).toHaveLength(0);
});
test("reminder selector and atomic duplicate prevention with rearming", async ({
  page,
  account,
}) => {
  expect(account).toBeTruthy();
  await page.getByRole("button", { name: "Add details", exact: false }).click();
  await expect(page.getByLabel("Reminder", { exact: true })).toBeDisabled();
  const t = (
    await requestJSON(page, "todos", "POST", {
      title: "Reminder task",
      due_date: addMinutes(5),
      reminder_minutes: 15,
    })
  ).body;
  const first = await requestJSON(page, "notifications/check");
  expect(first.body.todos).toHaveLength(1);
  expect(
    (await requestJSON(page, "notifications/check")).body.todos,
  ).toHaveLength(0);
  await requestJSON(page, `todos/${t.id}`, "PUT", { reminder_minutes: 30 });
  expect(
    (await requestJSON(page, "notifications/check")).body.todos,
  ).toHaveLength(1);
  await page.reload();
  await expect(page.getByText("♧ 30m", { exact: true })).toBeVisible();
});
