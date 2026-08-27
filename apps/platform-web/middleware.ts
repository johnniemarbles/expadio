import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Communications uses account/org query parameters for deep links. Resolve
 * them into the request-context headers consumed by the IAM-backed API routes.
 * Membership is still verified by resolveRequestContext; this middleware only
 * transports the requested scope and never grants access by itself.
 */
export function middleware(request: NextRequest) {
  const account = request.nextUrl.searchParams.get("account");
  const org = request.nextUrl.searchParams.get("org");
  if (!account && !org) return NextResponse.next();

  const requestHeaders = new Headers(request.headers);
  if (account) requestHeaders.set("x-expadio-tenant-id", account);
  if (org) requestHeaders.set("x-expadio-organization-id", org);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: [
    "/communications/:path*",
    "/api/communications/:path*",
    "/api/custody/:path*",
  ],
};
