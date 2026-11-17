import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { subtaskDB, userDB, type UpdateSubtaskDto } from "@/lib/db";
import { isAllowedMutationOrigin } from "@/lib/requestOrigin";
import { TodoValidationError } from "@/lib/todoValidation";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

function parseId(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

function parseUpdateBody(body: unknown): UpdateSubtaskDto | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  const keys = Object.keys(record);
  if (!keys.length || !keys.every((key) => key === "title" || key === "completed")
    || (record.title !== undefined && (typeof record.title !== "string" || !record.title.trim()))
    || (record.completed !== undefined && typeof record.completed !== "boolean")) return null;
  const update: UpdateSubtaskDto = {};
  if (typeof record.title === "string") update.title = record.title;
  if (typeof record.completed === "boolean") update.completed = record.completed;
  return update;
}

async function authorize(request: Request, params: Promise<{ id: string }>) {
  const session = await getSession();
  if (!session || !userDB.findById(session.userId)) {
    throw new TodoValidationError("Not authenticated", 401);
  }
  if (!isAllowedMutationOrigin(request)) {
    throw new TodoValidationError("Request origin not allowed", 403);
  }
  const id = parseId((await params).id);
  if (id === null || !subtaskDB.findById(id, session.userId)) {
    throw new TodoValidationError("Subtask not found", 404);
  }
  return { id, userId: session.userId };
}

async function jsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch (error) {
    if (error instanceof SyntaxError) throw new TodoValidationError("Invalid JSON");
    throw error;
  }
}

function errorResponse(error: unknown): NextResponse {
  if (error instanceof TodoValidationError) {
    return NextResponse.json({ error: error.message }, {
      status: error.status, headers: { "Cache-Control": "no-store" },
    });
  }
  console.error("Subtask mutation failed", error instanceof Error ? error.name : "UnknownError");
  return NextResponse.json({ error: "Subtask operation unavailable" }, {
    status: 500, headers: { "Cache-Control": "no-store" },
  });
}

export async function PUT(request: Request, { params }: Context) {
  try {
    const { id, userId } = await authorize(request, params);
    const body = await jsonBody(request);
    const update = parseUpdateBody(body);
    if (!update) throw new TodoValidationError("Invalid subtask update");
    const updated = subtaskDB.update(id, userId, update);
    if (!updated) throw new TodoValidationError("Subtask not found", 404);
    return NextResponse.json(updated, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: Context) {
  try {
    const { id, userId } = await authorize(request, params);
    if (!subtaskDB.delete(id, userId)) throw new TodoValidationError("Subtask not found", 404);
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
