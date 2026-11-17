import { NextRequest } from "next/server";
import { authHandler } from "@/lib/webauthn";
type Context = { params: Promise<{ action: string }> };
export async function POST(request: NextRequest, { params }: Context) {
  const { action } = await params;
  if (action === "me") return new Response(null, { status: 405 });
  return authHandler(request, action);
}
export async function GET(request: NextRequest, { params }: Context) {
  const { action } = await params;
  if (action !== "me") return new Response(null, { status: 405 });
  return authHandler(request, action);
}
