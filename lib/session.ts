import { SignJWT, jwtVerify } from "jose";
import type { Session } from "./db";
function key() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32)
    throw new Error("Set SESSION_SECRET to at least 32 random characters");
  return new TextEncoder().encode(secret);
}
export async function signToken(data: Record<string, unknown>, expiry = "7d") {
  return new SignJWT(data)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer("singapore-todo")
    .setAudience("singapore-todo")
    .setExpirationTime(expiry)
    .sign(key());
}
export async function verifyToken(token: string) {
  try {
    return (
      await jwtVerify(token, key(), {
        algorithms: ["HS256"],
        issuer: "singapore-todo",
        audience: "singapore-todo",
      })
    ).payload;
  } catch {
    return null;
  }
}
export async function verifySession(token?: string): Promise<Session | null> {
  if (!token) return null;
  const p = await verifyToken(token);
  return p &&
    p.purpose === "session" &&
    Number.isInteger(p.userId) &&
    typeof p.username === "string"
    ? { userId: p.userId as number, username: p.username }
    : null;
}
