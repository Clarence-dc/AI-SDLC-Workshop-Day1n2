import { handleAuth } from "@/lib/webauthn";

export const runtime = "nodejs";
export function POST(request: Request) {
  return handleAuth(request, "login-verify");
}
