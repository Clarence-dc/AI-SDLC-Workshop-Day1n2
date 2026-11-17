import { handleAuth } from "@/lib/webauthn";

export const runtime = "nodejs";
export function GET(request: Request) {
  return handleAuth(request, "me");
}
