import { cookies } from "next/headers";
import { signToken, verifySession } from "./session";
import type { Session } from "./db";
export const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};
export async function createSession(session: Session) {
  (await cookies()).set(
    "session",
    await signToken({ ...session, purpose: "session" }),
    { ...cookieOptions, maxAge: 7 * 24 * 60 * 60 },
  );
}
export async function getSession() {
  return verifySession((await cookies()).get("session")?.value);
}
export async function deleteSession() {
  (await cookies()).delete("session");
}
