import { NextResponse } from "next/server";
import { getSession } from "./auth";
import { todoDB, userDB } from "./db";
import { TodoValidationError } from "./todoValidation";

type Action = "list" | "read" | "create" | "update" | "delete";

async function jsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch (error) {
    if (error instanceof SyntaxError) throw new TodoValidationError("Invalid JSON");
    throw error;
  }
}

export async function handleTodoRequest(
  request: Request, action: Action, params?: Promise<{ id: string }>,
): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session || !userDB.findById(session.userId)) {
      throw new TodoValidationError("Not authenticated", 401);
    }
    if (request.method !== "GET") {
      const origin = process.env.RP_ORIGIN ?? new URL(request.url).origin;
      if (request.headers.get("origin") !== origin) {
        throw new TodoValidationError("Request origin not allowed", 403);
      }
    }
    const headers = { "Cache-Control": "no-store" };
    if (action === "list") return NextResponse.json(todoDB.findAllByUser(session.userId), { headers });
    if (action === "create") {
      return NextResponse.json(todoDB.create(session.userId, await jsonBody(request)), { status: 201, headers });
    }
    const rawId = (await params)?.id;
    const id = Number(rawId);
    if (!rawId || !/^[1-9]\d*$/.test(rawId) || !Number.isSafeInteger(id)) {
      throw new TodoValidationError("Todo not found", 404);
    }
    const existing = todoDB.findById(id, session.userId);
    if (!existing) throw new TodoValidationError("Todo not found", 404);
    if (action === "read") return NextResponse.json(existing, { headers });
    if (action === "update") {
      const todo = todoDB.update(id, session.userId, await jsonBody(request));
      if (!todo) throw new TodoValidationError("Todo not found", 404);
      return NextResponse.json({ todo }, { headers });
    }
    if (!todoDB.delete(id, session.userId)) throw new TodoValidationError("Todo not found", 404);
    return NextResponse.json({ success: true }, { headers });
  } catch (error) {
    if (error instanceof TodoValidationError) {
      return NextResponse.json({ error: error.message }, {
        status: error.status, headers: { "Cache-Control": "no-store" },
      });
    }
    console.error("Todo request failed", error instanceof Error ? error.name : "UnknownError");
    return NextResponse.json({ error: "Todo operation unavailable" }, {
      status: 500, headers: { "Cache-Control": "no-store" },
    });
  }
}
