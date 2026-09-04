import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import type { NextFetchEvent, NextRequest } from 'next/server';

const isProtectedRoute = createRouteMatcher(['/((?!sign-in|sign-up).*)']);
const isPublicRoute = createRouteMatcher(['/enquire(.*)', '/api/public/(.*)']);

// clerkMiddleware handles Clerk auth for protected routes.
const clerkHandler = clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request) && isProtectedRoute(request)) await auth.protect();
});

export default function middleware(request: NextRequest, event: NextFetchEvent) {
  // Return immediately for public routes, bypassing ALL Clerk processing.
  //
  // Without this guard, Clerk's dev-browser redirect (307) fires for every unauthenticated
  // request and constructs the Location URL from the Host header. When traffic arrives via a
  // Cloudflare custom-hostname Worker, Host is the Railway origin hostname — not the tenant's
  // custom domain. The browser then follows the redirect directly to Railway (bypassing CF),
  // which strips the X-Forwarded-Host header that brand-web needs for tenant resolution → 404.
  if (isPublicRoute(request)) return NextResponse.next();

  return clerkHandler(request, event);
}

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
