import assert from "node:assert/strict";
import { after, test } from "node:test";
import { SignJWT } from "jose";
import { signSessionToken, verifySessionToken } from "../lib/auth";

const originalSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = "test-only-session-signing-key-not-for-production";
const session = { userId: 7, username: "alice" };
const key = new TextEncoder().encode(process.env.JWT_SECRET);

after(() => {
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
});

test("signed sessions round-trip with a seven-day expiry", async () => {
  const token = await signSessionToken(session);
  assert.deepEqual(await verifySessionToken(token), session);
  const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
  assert.equal(payload.exp - payload.iat, 7 * 24 * 60 * 60);
});

test("tampered and malformed tokens are rejected", async () => {
  const token = await signSessionToken(session);
  const [header, , signature] = token.split(".");
  const changed = Buffer.from(JSON.stringify({ ...session, userId: 99 })).toString("base64url");
  assert.equal(await verifySessionToken(`${header}.${changed}.${signature}`), null);
  assert.equal(await verifySessionToken("not-a-jwt"), null);
});

test("expired sessions and tokens without expiry are rejected", async () => {
  const expired = await new SignJWT(session)
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt(1).setExpirationTime(2).sign(key);
  const noExpiry = await new SignJWT(session)
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().sign(key);
  assert.equal(await verifySessionToken(expired), null);
  assert.equal(await verifySessionToken(noExpiry), null);
});

test("wrong signing keys, algorithms and invalid identities are rejected", async () => {
  for (const [claims, algorithm, signingKey] of [
    [session, "HS256", new TextEncoder().encode("a-different-test-only-signing-key")],
    [session, "HS384", key],
    [{ userId: 0, username: "alice" }, "HS256", key],
    [{ userId: 1.5, username: "alice" }, "HS256", key],
    [{ userId: "7", username: "alice" }, "HS256", key],
    [{ userId: 7, username: "" }, "HS256", key],
  ] as const) {
    const token = await new SignJWT(claims).setProtectedHeader({ alg: algorithm })
      .setIssuedAt().setExpirationTime("7d").sign(signingKey);
    assert.equal(await verifySessionToken(token), null);
  }
});

test("missing or weak signing configuration fails explicitly", async () => {
  const secret = process.env.JWT_SECRET;
  try {
    for (const value of ["", "too-short"]) {
      process.env.JWT_SECRET = value;
      await assert.rejects(signSessionToken(session), /JWT_SECRET/);
      await assert.rejects(verifySessionToken("not-a-jwt"), /JWT_SECRET/);
    }
  } finally {
    process.env.JWT_SECRET = secret;
  }
});
