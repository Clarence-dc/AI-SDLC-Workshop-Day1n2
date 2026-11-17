import {
  test,
  expect,
  login,
  virtualAuthenticator,
  requestJSON,
} from "./helpers";
test("passkey registration, persistent session, second passkey, logout and login", async ({
  page,
  account,
}) => {
  await page.reload();
  await expect(page).toHaveURL("/");
  const me = await requestJSON(page, "auth/me");
  expect(me.body.username).toBe(account);
  const cookie = (await page.context().cookies()).find(
    (c) => c.name === "session",
  );
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.expires).toBeGreaterThan(Date.now() / 1000 + 6 * 86400);
  const second = await virtualAuthenticator(page, "usb");
  await page.getByText("Data & account").click();
  await page
    .getByRole("button", { name: "Add a passkey", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Another passkey added");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL("/login");
  await page.goto("/calendar");
  await expect(page).toHaveURL("/login");
  await login(page, account);
  await page.goto("/login");
  await expect(page).toHaveURL("/");
  await second.cdp.detach();
});
test("unauthenticated APIs reject and unknown account cannot sign in", async ({
  page,
}) => {
  await page.goto("/login");
  const r = await requestJSON(page, "todos");
  expect(r.status).toBe(401);
  await page
    .getByLabel("Username", { exact: true })
    .fill("unknown_account_987");
  await page.getByRole("button", { name: "Sign in with passkey" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "No passkey found" }),
  ).toBeVisible();
});
test("duplicate usernames and replayed challenges are rejected", async ({
  page,
  account,
  browser,
}) => {
  const context = await browser.newContext();
  const other = await context.newPage();
  await other.goto("/login");
  const duplicate = await requestJSON(other, "auth/register-options", "POST", {
    username: account,
  });
  expect(duplicate.status).toBe(409);
  const replay = await requestJSON(page, "auth/register-verify", "POST", {});
  expect(replay.status).toBe(400);
  await context.close();
});
