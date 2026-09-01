import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/webhooks(.*)',
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
  if (!isPublicRoute(req)) {
    await auth.protect()
  }

  const params = req.nextUrl.searchParams
  const accountParam = params.get('account')
  const orgParam = params.get('org')

  const tenantId = pickUuid(accountParam, req.cookies.get(TENANT_COOKIE)?.value)
  const organizationId = pickUuid(orgParam, req.cookies.get(ORG_COOKIE)?.value)

  const requestHeaders = new Headers(req.headers)
  if (tenantId) requestHeaders.set('x-expadio-tenant-id', tenantId)
  if (organizationId) requestHeaders.set('x-expadio-organization-id', organizationId)

  const response = NextResponse.next({ request: { headers: requestHeaders } })
  const cookieOptions = { httpOnly: true, sameSite: 'lax' as const, path: '/', secure: process.env.NODE_ENV === 'production' }
  if (accountParam && UUID.test(accountParam)) response.cookies.set(TENANT_COOKIE, accountParam, cookieOptions)
  if (orgParam && UUID.test(orgParam)) response.cookies.set(ORG_COOKIE, orgParam, cookieOptions)
  return response
})

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}
