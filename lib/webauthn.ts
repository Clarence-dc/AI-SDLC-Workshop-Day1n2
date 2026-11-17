import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createSession, deleteSession, getSession, validateSessionConfiguration } from "./auth";
import {
  addAuthenticator,
  authenticatorDB,
  consumeChallenge,
  registerUser,
  saveChallenge,
  userDB,
} from "./db";

const CHALLENGE_COOKIE = "webauthn_challenge";
const CHALLENGE_SECONDS = 300;
const MAX_BODY_BYTES = 64 * 1024;
type Purpose = "register" | "login" | "enroll";

class AuthError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export function relyingParty() {
  const origin = process.env.RP_ORIGIN ?? "http://localhost:3000";
  const rpID = process.env.RP_ID ?? "localhost";
  const rpName = process.env.RP_NAME ?? "Todo App";
  const url = new URL(origin);
  if (url.origin !== origin || url.username || url.password
    || (url.hostname !== rpID && !url.hostname.endsWith(`.${rpID}`))
    || (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "localhost"))
    || (process.env.NODE_ENV === "production"
      && (!process.env.RP_ORIGIN || !process.env.RP_ID || url.protocol !== "https:"))) {
    throw new Error("Invalid RP_ORIGIN or RP_ID configuration");
  }
  return { origin, rpID, rpName };
}

function assertOrigin(request: Request) {
  if (request.headers.get("origin") !== relyingParty().origin) {
    throw new AuthError(403, "Request origin not allowed");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    throw new AuthError(415, "Content-Type must be application/json");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new AuthError(400, "JSON body required");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new AuthError(413, "Request body too large");
    }
    chunks.push(value);
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) throw new AuthError(400, "Invalid JSON");
    throw error;
  }
  if (!isRecord(body)) throw new AuthError(400, "JSON object required");
  return body;
}

function usernameFrom(body: Record<string, unknown>): string {
  if (typeof body.username !== "string"
    || !body.username.trim() || body.username.trim().length > 64) {
    throw new AuthError(400, "Username must contain 1 to 64 characters");
  }
  return body.username.trim();
}

function isRegistration(value: unknown): value is RegistrationResponseJSON {
  return isRecord(value) && typeof value.id === "string"
    && typeof value.rawId === "string" && value.type === "public-key"
    && isRecord(value.clientExtensionResults) && isRecord(value.response)
    && typeof value.response.clientDataJSON === "string"
    && typeof value.response.attestationObject === "string";
}

function isAuthentication(value: unknown): value is AuthenticationResponseJSON {
  return isRecord(value) && typeof value.id === "string"
    && typeof value.rawId === "string" && value.type === "public-key"
    && isRecord(value.clientExtensionResults) && isRecord(value.response)
    && typeof value.response.clientDataJSON === "string"
    && typeof value.response.authenticatorData === "string"
    && typeof value.response.signature === "string";
}

async function storeChallenge(
  purpose: Purpose, username: string, userId: number | null, challenge: string,
) {
  const cookieStore = await cookies();
  const previous = cookieStore.get(CHALLENGE_COOKIE)?.value;
  if (previous) consumeChallenge(previous);
  const id = randomUUID();
  saveChallenge({
    id, purpose, username, user_id: userId, challenge,
    expires_at: Date.now() + CHALLENGE_SECONDS * 1000,
  });
  cookieStore.set(CHALLENGE_COOKIE, id, {
    httpOnly: true, secure: process.env.NODE_ENV === "production",
    sameSite: "strict", path: "/api/auth", maxAge: CHALLENGE_SECONDS,
  });
}

async function takeChallenge(purpose: Purpose, username?: string) {
  const cookieStore = await cookies();
  const id = cookieStore.get(CHALLENGE_COOKIE)?.value;
  cookieStore.set(CHALLENGE_COOKIE, "", {
    httpOnly: true, secure: process.env.NODE_ENV === "production",
    sameSite: "strict", path: "/api/auth", maxAge: 0,
  });
  const challenge = id ? consumeChallenge(id) : null;
  if (!challenge || challenge.purpose !== purpose
    || (username !== undefined && challenge.username !== username)) {
    throw new AuthError(400, "Passkey request expired or invalid; please start again");
  }
  return challenge;
}

async function registrationOptions(request: Request, enroll: boolean) {
  const { rpID, rpName } = relyingParty();
  const session = enroll ? await getSession() : null;
  const user = session ? userDB.findById(session.userId) : null;
  if (enroll && !user) throw new AuthError(401, "Not authenticated");
  const username = user ? user.username : usernameFrom(await readBody(request));
  if (!enroll && userDB.findByUsername(username)) {
    throw new AuthError(409, "Username already taken");
  }
  const options = await generateRegistrationOptions({
    rpID, rpName, userName: username,
    userID: createHash("sha256").update(username).digest(),
    attestationType: "none",
    authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
    excludeCredentials: user
      ? authenticatorDB.findByUserId(user.id).map((credential) => ({ id: credential.credential_id }))
      : [],
  });
  await storeChallenge(enroll ? "enroll" : "register", username, user?.id ?? null, options.challenge);
  return options;
}

async function registrationVerify(request: Request, enroll: boolean) {
  const body = await readBody(request);
  const session = enroll ? await getSession() : null;
  const user = session ? userDB.findById(session.userId) : null;
  if (enroll && !user) throw new AuthError(401, "Not authenticated");
  const username = user ? user.username : usernameFrom(body);
  const challenge = await takeChallenge(enroll ? "enroll" : "register", username);
  if (enroll && challenge.user_id !== user?.id) throw new AuthError(401, "Not authenticated");
  if (!isRegistration(body.response)) throw new AuthError(400, "Invalid passkey response");
  const { origin, rpID } = relyingParty();
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body.response, expectedChallenge: challenge.challenge,
      expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
    });
  } catch {
    throw new AuthError(400, "Passkey verification failed");
  }
  if (!verification.verified) throw new AuthError(400, "Passkey verification failed");
  const credential = verification.registrationInfo.credential;
  const input = {
    credential_id: isoBase64URL.fromBuffer(isoBase64URL.toBuffer(credential.id)),
    credential_public_key: Buffer.from(credential.publicKey),
    counter: credential.counter ?? 0,
    transports: credential.transports ?? [],
  };
  if (authenticatorDB.findByCredentialId(input.credential_id)) {
    throw new AuthError(409, "Passkey already registered");
  }
  if (enroll && user) {
    addAuthenticator(user.id, input);
  } else {
    if (userDB.findByUsername(username)) throw new AuthError(409, "Username already taken");
    const registered = registerUser(username, input);
    await createSession(registered);
  }
  return { success: true };
}

async function loginOptions(request: Request) {
  const username = usernameFrom(await readBody(request));
  const user = userDB.findByUsername(username);
  const credentials = user ? authenticatorDB.findByUserId(user.id) : [];
  const options = await generateAuthenticationOptions({
    rpID: relyingParty().rpID, userVerification: "required",
    allowCredentials: credentials.length
      ? credentials.map((credential) => ({ id: credential.credential_id }))
      : [{ id: randomBytes(32).toString("base64url") }],
  });
  await storeChallenge("login", username, user?.id ?? null, options.challenge);
  return options;
}

async function loginVerify(request: Request) {
  const body = await readBody(request);
  const challenge = await takeChallenge("login", usernameFrom(body));
  if (!isAuthentication(body.response)) throw new AuthError(400, "Invalid passkey response");
  const credential = authenticatorDB.findByCredentialId(body.response.id);
  if (!credential || credential.user_id !== challenge.user_id) {
    throw new AuthError(401, "Passkey verification failed");
  }
  const user = userDB.findById(credential.user_id);
  if (!user || user.username !== challenge.username) throw new AuthError(401, "Passkey verification failed");
  const { origin, rpID } = relyingParty();
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: body.response, expectedChallenge: challenge.challenge,
      expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
      credential: {
        id: credential.credential_id,
        publicKey: new Uint8Array(credential.credential_public_key),
        counter: credential.counter ?? 0,
      },
    });
  } catch {
    throw new AuthError(401, "Passkey verification failed");
  }
  if (!verification.verified) throw new AuthError(401, "Passkey verification failed");
  authenticatorDB.updateCounter(credential.id, verification.authenticationInfo.newCounter ?? 0);
  await createSession(user);
  return { success: true };
}

export async function handleAuth(request: Request, action: string) {
  try {
    validateSessionConfiguration();
    if (request.method !== "GET") assertOrigin(request);
    let result: unknown;
    switch (action) {
      case "register-options": result = await registrationOptions(request, false); break;
      case "register-verify": result = await registrationVerify(request, false); break;
      case "enroll-options": result = await registrationOptions(request, true); break;
      case "enroll-verify": result = await registrationVerify(request, true); break;
      case "login-options": result = await loginOptions(request); break;
      case "login-verify": result = await loginVerify(request); break;
      case "logout": {
        await deleteSession();
        const cookieStore = await cookies();
        const id = cookieStore.get(CHALLENGE_COOKIE)?.value;
        if (id) consumeChallenge(id);
        cookieStore.set(CHALLENGE_COOKIE, "", { path: "/api/auth", maxAge: 0 });
        result = { success: true };
        break;
      }
      case "me": {
        const session = await getSession();
        const user = session ? userDB.findById(session.userId) : null;
        if (!user) throw new AuthError(401, "Not authenticated");
        result = { user: { id: user.id, username: user.username } };
        break;
      }
      default: throw new Error("Unknown authentication action");
    }
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, {
        status: error.status, headers: { "Cache-Control": "no-store" },
      });
    }
    console.error("Authentication request failed", error instanceof Error ? error.name : "UnknownError");
    return NextResponse.json({ error: "Authentication unavailable" }, {
      status: 500, headers: { "Cache-Control": "no-store" },
    });
  }
}
