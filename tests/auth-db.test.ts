import assert from "node:assert/strict";
import { test } from "node:test";

process.env.DATABASE_PATH = ":memory:";

test("registration is atomic and authenticators retain ownership and monotonic counters", async () => {
  const { registerUser, addAuthenticator, userDB, authenticatorDB } = await import("../lib/db");
  const credential = {
    credential_id: "first-key", credential_public_key: Buffer.from([1, 2, 3]),
    counter: 0, transports: ["internal"],
  };
  const user = registerUser("alice", credential);
  assert.equal(userDB.findByUsername("alice")?.id, user.id);
  assert.deepEqual(authenticatorDB.findByCredentialId("first-key")?.transports, ["internal"]);
  assert.throws(() => registerUser("rolled-back", credential));
  assert.equal(userDB.findByUsername("rolled-back"), undefined);
  assert.throws(() => registerUser("alice", { ...credential, credential_id: "unused" }));
  assert.equal(authenticatorDB.findByCredentialId("unused"), undefined);
  const second = addAuthenticator(user.id, { ...credential, credential_id: "second-key" });
  assert.equal(authenticatorDB.findByUserId(user.id).length, 2);
  authenticatorDB.updateCounter(second.id, 0);
  authenticatorDB.updateCounter(second.id, 1);
  assert.throws(() => authenticatorDB.updateCounter(second.id, 1));
  assert.throws(() => authenticatorDB.updateCounter(second.id, 0));
  assert.equal(authenticatorDB.findByCredentialId("second-key")?.counter, 1);
  assert.throws(() => addAuthenticator(user.id + 100, { ...credential, credential_id: "orphan" }));
});

test("challenges preserve binding, expire and can only be consumed once", async () => {
  const { saveChallenge, consumeChallenge } = await import("../lib/db");
  const challenge = {
    id: "request", user_id: null, username: "alice", purpose: "register" as const,
    challenge: "random-challenge", expires_at: Date.now() + 60_000,
  };
  saveChallenge(challenge);
  assert.deepEqual(consumeChallenge(challenge.id), challenge);
  assert.equal(consumeChallenge(challenge.id), null);
  saveChallenge({ ...challenge, id: "expired", expires_at: Date.now() - 1 });
  assert.equal(consumeChallenge("expired"), null);
  assert.equal(consumeChallenge("missing"), null);
});
