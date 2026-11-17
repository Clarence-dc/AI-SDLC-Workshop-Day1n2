import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { signToken, verifySession } from "../../lib/session";
process.env.SESSION_SECRET = randomBytes(48).toString("hex");
test("session signature, purpose, expiry and tampering fail closed", async () => {
  const token = await signToken({
    userId: 7,
    username: "alice",
    purpose: "session",
  });
  assert.deepEqual(await verifySession(token), {
    userId: 7,
    username: "alice",
  });
  assert.equal(await verifySession(token.slice(0, -8) + "tampered"), null);
  assert.equal(
    await verifySession(
      await signToken(
        { userId: 7, username: "alice", purpose: "session" },
        "-1s",
      ),
    ),
    null,
  );
  assert.equal(
    await verifySession(
      await signToken({ userId: 7, username: "alice", purpose: "challenge" }),
    ),
    null,
  );
  assert.equal(await verifySession(), null);
});
