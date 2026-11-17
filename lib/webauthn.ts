import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { challengeDB, db, userDB, allowRequest } from "./db";
import {
  cookieOptions,
  createSession,
  deleteSession,
  getSession,
} from "./auth";
import { assertOrigin, errorResponse, HttpError, jsonBody } from "./api";
const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(64)
  .regex(
    /^[a-zA-Z0-9_.-]+$/,
    "Use letters, numbers, dots, underscores or hyphens",
  );
const origin = process.env.APP_ORIGIN || "http://localhost:3000";
const rpID = process.env.RP_ID || new URL(origin).hostname;
export function validCounter(previous: number, next: number) {
  return (previous === 0 && next === 0) || next > previous;
}
export async function authHandler(request: NextRequest, action: string) {
  try {
    assertOrigin(request);
    // Deploy behind a trusted proxy that overwrites X-Forwarded-For for per-client limiting.
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    if (action === "me") {
      const s = await getSession();
      if (!s) throw new HttpError("Not authenticated", 401);
      if (!allowRequest(`auth-user:${s.userId}`, 600))
        throw new HttpError("Too many requests. Try again in a minute.", 429);
      return NextResponse.json(s);
    }
    if (action === "logout") {
      if (!allowRequest(`logout:${ip}`, 60))
        throw new HttpError("Too many requests. Try again in a minute.", 429);
      await deleteSession();
      return NextResponse.json({ success: true });
    }
    if (!allowRequest(`auth:${ip}`, 60))
      throw new HttpError("Too many attempts. Try again in a minute.", 429);
    const body = await jsonBody(request);
    if (action === "register-options" || action === "login-options") {
      const username = usernameSchema.parse(body.username);
      const user = userDB.byName(username);
      const session = await getSession();
      if (action === "register-options") {
        if (user && session?.userId !== user.id)
          throw new HttpError(
            "Username already exists. Sign in to add another passkey.",
            409,
          );
        const options = await generateRegistrationOptions({
          rpName: "Daylight Todo",
          rpID,
          userName: username,
          userID: user
            ? new TextEncoder().encode(`user:${user.id}`)
            : undefined,
          attestationType: "none",
          excludeCredentials: user
            ? userDB
                .authenticators(user.id)
                .map((a) => ({ id: a.credential_id }))
            : [],
          authenticatorSelection: {
            residentKey: "preferred",
            userVerification: "required",
          },
        });
        const challengeId = challengeDB.create(
          options.challenge,
          username,
          "register",
          user?.id,
        );
        (await cookies()).set("webauthn-challenge", challengeId, {
          ...cookieOptions,
          maxAge: 300,
        });
        return NextResponse.json(options);
      }
      if (!user) throw new HttpError("No passkey found for that username", 404);
      const options = await generateAuthenticationOptions({
        rpID,
        allowCredentials: userDB
          .authenticators(user.id)
          .map((a) => ({ id: a.credential_id })),
        userVerification: "required",
      });
      const challengeId = challengeDB.create(
        options.challenge,
        user.username,
        "login",
        user.id,
      );
      (await cookies()).set("webauthn-challenge", challengeId, {
        ...cookieOptions,
        maxAge: 300,
      });
      return NextResponse.json(options);
    }
    const kind =
      action === "register-verify"
        ? "register"
        : action === "login-verify"
          ? "login"
          : null;
    if (!kind) throw new HttpError("Not found", 404);
    const jar = await cookies();
    const challengeId = jar.get("webauthn-challenge")?.value;
    jar.delete("webauthn-challenge");
    const challenge = challengeId
      ? challengeDB.consume(challengeId, kind)
      : null;
    if (!challenge)
      throw new HttpError(
        "Challenge expired or already used. Please try again.",
        400,
      );
    if (kind === "register") {
      if (
        challenge.user_id &&
        (await getSession())?.userId !== challenge.user_id
      )
        throw new HttpError("Sign in before adding a passkey", 401);
      let result;
      try {
        result = await verifyRegistrationResponse({
          response: body as RegistrationResponseJSON,
          expectedChallenge: challenge.challenge,
          expectedOrigin: origin,
          expectedRPID: rpID,
          requireUserVerification: true,
        });
      } catch {
        throw new HttpError("Passkey verification failed", 400);
      }
      if (!result.verified || !result.registrationInfo)
        throw new HttpError("Passkey verification failed", 400);
      const credential = result.registrationInfo.credential;
      const user = db.transaction(() => {
        const u = challenge.user_id
          ? userDB.byId(challenge.user_id)!
          : userDB.create(challenge.username);
        userDB.addCredential(
          u.id,
          isoBase64URL.fromBuffer(isoBase64URL.toBuffer(credential.id)),
          credential.publicKey,
          credential.counter ?? 0,
        );
        return u;
      })();
      await createSession({ userId: user.id, username: user.username });
      return NextResponse.json({ verified: true });
    }
    const response = body as AuthenticationResponseJSON;
    const credential =
      typeof response.id === "string"
        ? userDB.credential(response.id)
        : undefined;
    if (!credential || credential.user_id !== challenge.user_id)
      throw new HttpError("Passkey verification failed", 400);
    let result;
    try {
      result = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
        credential: {
          id: credential.credential_id,
          publicKey: new Uint8Array(credential.credential_public_key),
          counter: credential.counter ?? 0,
        },
      });
    } catch {
      throw new HttpError("Passkey verification failed", 400);
    }
    if (
      !result.verified ||
      !validCounter(
        credential.counter ?? 0,
        result.authenticationInfo.newCounter ?? 0,
      )
    )
      throw new HttpError("Passkey counter verification failed", 400);
    const updated = db
      .prepare("UPDATE authenticators SET counter=? WHERE id=? AND counter=?")
      .run(
        result.authenticationInfo.newCounter ?? 0,
        credential.id,
        credential.counter ?? 0,
      );
    if (!updated.changes)
      throw new HttpError(
        "Passkey was used concurrently. Please try again.",
        400,
      );
    const user = userDB.byId(credential.user_id)!;
    await createSession({ userId: user.id, username: user.username });
    return NextResponse.json({ verified: true });
  } catch (error) {
    return errorResponse(error);
  }
}
