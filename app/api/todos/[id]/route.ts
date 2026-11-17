import { handleTodoRequest } from "@/lib/todoApi";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export function GET(request: Request, { params }: Context) {
  return handleTodoRequest(request, "read", params);
}
export function PUT(request: Request, { params }: Context) {
  return handleTodoRequest(request, "update", params);
}
export function DELETE(request: Request, { params }: Context) {
  return handleTodoRequest(request, "delete", params);
}
