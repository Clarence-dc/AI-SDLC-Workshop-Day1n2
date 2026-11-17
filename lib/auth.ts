import { errors, jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";

export interface Session {
  userId: number;
  username: string;
}

const SESSION_COOKIE = "session";
const SESSION_SECONDS = 7 * 24 * 60 * 60;

function signingKey(): Uint8Array {
  const key = new TextEncoder().encode(process.env.JWT_SECRET ?? "");
  if (key.byteLength < 32) {
    throw new Error("JWT_SECRET must be configured with at least 32 bytes");
  }
  return key;
}

export function validateSessionConfiguration(): void {
  signingKey();
}

function isSession(value: unknown): value is Session {
  return typeof value === "object"
    && value !== null
    && "userId" in value
    && "username" in value
    && typeof value.userId === "number"
    && Number.isSafeInteger(value.userId)
    && value.userId > 0
    && typeof value.username === "string"
    && value.username.trim().length > 0;
}

export async function signSessionToken(session: Session): Promise<string> {
  if (!isSession(session)) throw new TypeError("Invalid session identity");
  return new SignJWT({ userId: session.userId, username: session.username })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(signingKey());
}

export async function verifySessionToken(token: string): Promise<Session | null> {
  const key = signingKey();
  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["HS256"],
      requiredClaims: ["iat", "exp"],
      maxTokenAge: "7d",
    });
    if (!isSession(payload)) return null;
    return { userId: payload.userId, username: payload.username };
  } catch (error) {
    if (error instanceof errors.JOSEError) return null;
    throw error;
  }
}

export async function createSession(user: { id: number; username: string }): Promise<void> {
  const token = await signSessionToken({ userId: user.id, username: user.username });
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
}

export async function getSession(): Promise<Session | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  return token ? verifySessionToken(token) : null;
}

export async function deleteSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
