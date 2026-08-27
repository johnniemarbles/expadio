import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

// Protect shell routes and api routes, but allow public access to sign-in
const isProtectedRoute = createRouteMatcher([
  '/((?!sign-in|sign-up).*)'
])

const TENANT_COOKIE = 'expadio-tenant'
const ORG_COOKIE = 'expadio-org'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function pickUuid(...candidates: (string | null | undefined)[]): string | null {
  for (const value of candidates) {
    if (typeof value === 'string' && UUID.test(value)) return value
  }
  return null
}

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    await auth.protect()
  }

  // Workspace selection propagation.
  //
  // The shell threads the active workspace onto every navigation and fetch as
  // `?account=<tenantId>&org=<organizationId>`. Translate that here into the
  // `x-expadio-*` request headers that `resolveRequestContext` reads, so a
  // route handler resolves the tenant the operator actually selected instead
  // of a hardcoded demo default. A cookie persists the last selection so deep
  // links and client fetches that drop the query string keep the same
  // workspace.
  //
  // This is propagation, not authorization: the injected values are only a
  // *request* for a tenant. `resolveRequestContext` still verifies membership
  // against the IAM spine, so a forged header resolves to a denial rather than
  // to another tenant's data (§4.4, tenant isolation).
  const params = req.nextUrl.searchParams
  const accountParam = params.get('account')
  const orgParam = params.get('org')

  const tenantId = pickUuid(accountParam, req.cookies.get(TENANT_COOKIE)?.value)
  const organizationId = pickUuid(orgParam, req.cookies.get(ORG_COOKIE)?.value)

  const requestHeaders = new Headers(req.headers)
  if (tenantId) requestHeaders.set('x-expadio-tenant-id', tenantId)
  if (organizationId) requestHeaders.set('x-expadio-organization-id', organizationId)

  const response = NextResponse.next({ request: { headers: requestHeaders } })

  // Persist a fresh, well-formed selection for subsequent requests.
  const cookieOptions = { httpOnly: true, sameSite: 'lax' as const, path: '/', secure: process.env.NODE_ENV === 'production' }
  if (accountParam && UUID.test(accountParam)) {
    response.cookies.set(TENANT_COOKIE, accountParam, cookieOptions)
  }
  if (orgParam && UUID.test(orgParam)) {
    response.cookies.set(ORG_COOKIE, orgParam, cookieOptions)
  }

  return response
})

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}
