import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { subtaskDB, todoDB, userDB } from "@/lib/db";
import { isAllowedMutationOrigin } from "@/lib/requestOrigin";
import { TodoValidationError } from "@/lib/todoValidation";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

function parseId(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

export async function POST(request: Request, { params }: Context) {
  try {
    const session = await getSession();
    if (!session || !userDB.findById(session.userId)) {
      throw new TodoValidationError("Not authenticated", 401);
    }
    if (!isAllowedMutationOrigin(request)) {
      throw new TodoValidationError("Request origin not allowed", 403);
    }
    const parentId = parseId((await params).id);
    if (parentId === null || !todoDB.findById(parentId, session.userId)) {
      throw new TodoValidationError("Todo not found", 404);
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch (error) {
      if (error instanceof SyntaxError) throw new TodoValidationError("Invalid JSON");
      throw error;
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)
      || Object.keys(body).length !== 1 || !("title" in body)
      || typeof body.title !== "string" || !body.title.trim()) {
      throw new TodoValidationError("Subtask title is required");
    }
    const subtask = subtaskDB.create(parentId, session.userId, { title: body.title });
    if (!subtask) throw new TodoValidationError("Todo not found", 404);
    return NextResponse.json(subtask, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof TodoValidationError) {
      return NextResponse.json({ error: error.message }, {
        status: error.status, headers: { "Cache-Control": "no-store" },
      });
    }
    console.error("Subtask creation failed", error instanceof Error ? error.name : "UnknownError");
    return NextResponse.json({ error: "Subtask operation unavailable" }, {
      status: 500, headers: { "Cache-Control": "no-store" },
    });
  }
}
