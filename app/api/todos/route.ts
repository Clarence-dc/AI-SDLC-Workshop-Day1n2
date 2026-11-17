import { handleTodoRequest } from "@/lib/todoApi";

export const runtime = "nodejs";
export function GET(request: Request) {
  return handleTodoRequest(request, "list");
}
export function POST(request: Request) {
  return handleTodoRequest(request, "create");
}
