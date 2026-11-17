import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { test } from "node:test";
import { isoCBOR } from "@simplewebauthn/server/helpers";

// Run only against an isolated test database and a server with RP_ORIGIN set to this URL.
const origin = process.env.AUTH_TEST_ORIGIN;
if (!origin) throw new Error("Set AUTH_TEST_ORIGIN to an isolated running test server");
const rpID = new URL(origin).hostname;
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest();
const encoded = (value: Buffer | Uint8Array) => Buffer.from(value).toString("base64url");

class Client {
  cookies = new Map<string, string>();

  async request(action: string, body?: unknown, requestOrigin: string = origin!) {
    const response = await fetch(`${origin}/api/auth/${action}`, {
      method: action === "me" ? "GET" : "POST",
      headers: {
        Origin: requestOrigin, "Content-Type": "application/json",
        Cookie: [...this.cookies].map(([key, value]) => `${key}=${value}`).join("; "),
      },
      body: action === "me" ? undefined : JSON.stringify(body ?? {}),
      redirect: "manual",
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";");
      const index = pair.indexOf("=");
      this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    return response;
  }
}

function authenticator() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" });
  assert.ok(jwk.x && jwk.y);
  const cose = isoCBOR.encode(new Map<number, number | Buffer>([
    [1, 2], [3, -7], [-1, 1],
    [-2, Buffer.from(jwk.x, "base64url")], [-3, Buffer.from(jwk.y, "base64url")],
  ]));
  const id = randomBytes(32);

  function clientData(type: string, challenge: string) {
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  }

  return {
    id: encoded(id),
    registration(challenge: string) {
      const idLength = Buffer.alloc(2);
      idLength.writeUInt16BE(id.length);
      const authData = Buffer.concat([
        hash(rpID), Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16),
        idLength, id, Buffer.from(cose),
      ]);
      return {
        id: encoded(id), rawId: encoded(id), type: "public-key", clientExtensionResults: {},
        response: {
          clientDataJSON: encoded(clientData("webauthn.create", challenge)),
          attestationObject: encoded(isoCBOR.encode(new Map<string, string | Buffer | Map<never, never>>([
            ["fmt", "none"], ["attStmt", new Map<never, never>()], ["authData", authData],
          ]))),
          transports: ["internal"],
        },
      };
    },
    authentication(challenge: string, counter: number) {
      const count = Buffer.alloc(4);
      count.writeUInt32BE(counter);
      const authData = Buffer.concat([hash(rpID), Buffer.from([0x05]), count]);
      const data = clientData("webauthn.get", challenge);
      return {
        id: encoded(id), rawId: encoded(id), type: "public-key", clientExtensionResults: {},
        response: {
          clientDataJSON: encoded(data), authenticatorData: encoded(authData),
          signature: encoded(sign("sha256", Buffer.concat([authData, hash(data)]), privateKey)),
        },
      };
    },
  };
}

test("real signed passkey API flows enforce sessions, ownership, counters and challenge consumption", async () => {
  const username = `passkey-test-${randomBytes(8).toString("hex")}`;
  const client = new Client();
  const key = authenticator();
  assert.equal((await client.request("me")).status, 401);
  assert.equal((await client.request("enroll-options")).status, 401);
  assert.equal((await client.request("register-options", { username }, "https://untrusted.example")).status, 403);
  const protectedPage = await fetch(origin!, { redirect: "manual" });
  assert.equal(protectedPage.status, 307);
  assert.equal(new URL(protectedPage.headers.get("location")!, origin).pathname, "/login");
  assert.equal((await fetch(`${origin}/calendar`, { redirect: "manual" })).status, 307);

  const options = await (await client.request("register-options", { username })).json();
  const registration = key.registration(options.challenge);
  const registered = await client.request("register-verify", { username, response: registration });
  assert.equal(registered.status, 200, await registered.text());
  const cookie = registered.headers.getSetCookie().find((value) => value.startsWith("session="));
  assert.ok(cookie?.includes("HttpOnly"));
  assert.match(cookie!, /Max-Age=604800/i);
  assert.match(cookie!, /SameSite=lax/i);
  const me = await (await client.request("me")).json();
  assert.equal(me.user.username, username);
  assert.equal((await client.request("register-verify", { username, response: registration })).status, 400);
  assert.equal((await client.request("register-options", { username })).status, 409);

  const secondKey = authenticator();
  const enrollment = await (await client.request("enroll-options")).json();
  assert.ok(enrollment.excludeCredentials.some((credential: { id: string }) => credential.id === key.id));
  assert.equal((await client.request("enroll-verify", {
    response: secondKey.registration(enrollment.challenge),
  })).status, 200);
  assert.equal((await client.request("logout")).status, 200);
  assert.equal((await client.request("me")).status, 401);

  const otherClient = new Client();
  const otherUsername = `${username}-other`;
  const otherKey = authenticator();
  const otherRegistration = await (await otherClient.request("register-options", { username: otherUsername })).json();
  assert.equal((await otherClient.request("register-verify", {
    username: otherUsername, response: otherKey.registration(otherRegistration.challenge),
  })).status, 200);
  const otherLogin = await (await client.request("login-options", { username: otherUsername })).json();
  assert.equal((await client.request("login-verify", {
    username: otherUsername, response: key.authentication(otherLogin.challenge, 1),
  })).status, 401);
  const boundLogin = await (await client.request("login-options", { username })).json();
  assert.equal((await otherClient.request("login-verify", {
    username, response: key.authentication(boundLogin.challenge, 1),
  })).status, 400);

  const unknown = await (await client.request("login-options", { username: `${username}-missing` })).json();
  assert.equal((await client.request("login-verify", {
    username: `${username}-missing`, response: key.authentication(unknown.challenge, 1),
  })).status, 401);

  for (const [credential, counter, status] of [
    [key, 1, 200], [key, 1, 401], [secondKey, 0, 200], [secondKey, 0, 200],
  ] as const) {
    const login = await (await client.request("login-options", { username })).json();
    assert.equal(login.allowCredentials.length, 2);
    const assertion = credential.authentication(login.challenge, counter);
    const loggedIn = await client.request("login-verify", { username, response: assertion });
    assert.equal(loggedIn.status, status, await loggedIn.text());
    assert.equal((await client.request("login-verify", { username, response: assertion })).status, 400);
  }
  assert.equal((await client.request("me")).status, 200);
  const validSession = client.cookies.get("session")!;
  client.cookies.set("session", `${validSession}tampered`);
  assert.equal((await client.request("me")).status, 401);
});
