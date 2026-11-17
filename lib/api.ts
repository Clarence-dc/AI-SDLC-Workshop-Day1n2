import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { getSession } from "./auth";
import { allowRequest } from "./db";
import type { Session } from "./db";
export class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export function assertOrigin(request: NextRequest) {
  if (
    !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
    request.headers.get("origin") !==
      new URL(process.env.APP_ORIGIN || "http://localhost:3000").origin
  )
    throw new HttpError("Invalid request origin", 403);
}
export async function jsonBody(request: NextRequest) {
  if (+(request.headers.get("content-length") || 0) > 5_000_000)
    throw new HttpError("File too large (maximum 5 MB)", 413);
  const text = await request.text();
  if (text.length > 5_000_000)
    throw new HttpError("File too large (maximum 5 MB)", 413);
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new HttpError("Invalid JSON format", 400);
  }
  if (data === null || typeof data !== "object" || Array.isArray(data))
    throw new HttpError("Expected a JSON object", 400);
  return data;
}
export function errorResponse(error: unknown) {
  if (error instanceof HttpError)
    return NextResponse.json(
      { error: error.message },
      { status: error.status },
    );
  if (error instanceof ZodError)
    return NextResponse.json(
      { error: error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  const message = error instanceof Error ? error.message : "";
  if (message === "Not found")
    return NextResponse.json({ error: message }, { status: 404 });
  if (message.includes("UNIQUE constraint"))
    return NextResponse.json(
      { error: "That name or passkey already exists" },
      { status: 409 },
    );
  if (/require|Due date|Invalid|Failed to import/.test(message))
    return NextResponse.json({ error: message }, { status: 400 });
  return NextResponse.json(
    { error: "Unable to complete this request" },
    { status: 500 },
  );
}
type Context = { params: Promise<Record<string, string>> };
export function secured(
  handler: (
    req: NextRequest,
    session: Session,
    params: Record<string, string>,
  ) => unknown | Promise<unknown>,
) {
  return async (request: NextRequest, context: Context) => {
    try {
      const session = await getSession();
      if (!session) throw new HttpError("Not authenticated", 401);
      assertOrigin(request);
      if (!allowRequest(`user:${session.userId}`, 600))
        throw new HttpError("Too many requests. Try again in a minute.", 429);
      const result = await handler(request, session, await context.params);
      return result instanceof Response
        ? result
        : NextResponse.json(result ?? { success: true });
    } catch (error) {
      return errorResponse(error);
    }
  };
}
export function id(value: string) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) throw new HttpError("Not found", 404);
  return n;
}
