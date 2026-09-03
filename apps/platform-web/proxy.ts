import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/health(.*)',
  '/api/webhooks(.*)',
])

const TENANT_COOKIE = 'expadio-tenant'
const ORG_COOKIE = 'expadio-org'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function validUuid(value: string | null | undefined): value is string {
  return typeof value === 'string' && UUID.test(value)
}

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect()
  }

  const params = req.nextUrl.searchParams
  const accountParam = params.get('account')
  const orgParam = params.get('org')
  const tenantCookie = req.cookies.get(TENANT_COOKIE)?.value
  const orgCookie = req.cookies.get(ORG_COOKIE)?.value

  const tenantId = validUuid(accountParam)
    ? accountParam
    : validUuid(tenantCookie)
      ? tenantCookie
      : null
  const organizationId = validUuid(orgParam)
    ? orgParam
    : validUuid(orgCookie)
      ? orgCookie
      : null
  const tenantSource = validUuid(accountParam) ? 'query' : validUuid(tenantCookie) ? 'cookie' : null
  const organizationSource = validUuid(orgParam) ? 'query' : validUuid(orgCookie) ? 'cookie' : null

  const requestHeaders = new Headers(req.headers)

  // These headers are derived only by this trusted proxy. Strip any caller-
  // supplied values before forwarding the resolved workspace preference.
  for (const name of [
    'x-expadio-tenant-id',
    'x-expadio-organization-id',
    'x-expadio-tenant-source',
    'x-expadio-organization-source',
  ]) {
    requestHeaders.delete(name)
  }

  if (tenantId) requestHeaders.set('x-expadio-tenant-id', tenantId)
  if (organizationId) requestHeaders.set('x-expadio-organization-id', organizationId)
  if (tenantSource) requestHeaders.set('x-expadio-tenant-source', tenantSource)
  if (organizationSource) requestHeaders.set('x-expadio-organization-source', organizationSource)

  const response = NextResponse.next({ request: { headers: requestHeaders } })
  const cookieOptions = { httpOnly: true, sameSite: 'lax' as const, path: '/', secure: process.env.NODE_ENV === 'production' }
  if (validUuid(accountParam)) response.cookies.set(TENANT_COOKIE, accountParam, cookieOptions)
  if (validUuid(orgParam)) response.cookies.set(ORG_COOKIE, orgParam, cookieOptions)
  return response
})

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}
