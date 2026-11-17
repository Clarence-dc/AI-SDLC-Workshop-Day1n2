import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "./lib/auth";

export async function middleware(request: NextRequest) {
  const token = request.cookies.get("session")?.value;
  if (!token || !(await verifySessionToken(token))) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/calendar/:path*"],
};
