/**
 * Cloudflare Worker — expadio.com forms proxy.
 *
 * Bound to all custom hostnames via Cloudflare for SaaS.
 * Cloudflare preserves the original tenant hostname in the Host header,
 * so we read it, set X-Forwarded-Host, and proxy to Railway brand-web.
 *
 * Required secret: BRAND_WEB_ORIGIN (e.g. https://brand-web.up.railway.app)
 * Set via: wrangler secret put BRAND_WEB_ORIGIN
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const originalHost = request.headers.get("host") ?? url.hostname;

    // Health probe shortcut.
    if (url.pathname === "/health" && originalHost === "forms.expadio.com") {
      return new Response("ok\n", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }

    const origin = env.BRAND_WEB_ORIGIN?.replace(/\/$/, "");
    if (!origin) {
      return new Response("Worker misconfigured: BRAND_WEB_ORIGIN not set.", { status: 503 });
    }

    const target = new URL(url.pathname + url.search, origin);

    const headers = new Headers(request.headers);
    headers.set("X-Forwarded-Host", originalHost);
    headers.set("X-Forwarded-Proto", "https");
    // Set Host to the Railway origin so TLS/SNI matches the upstream certificate.
    headers.set("Host", new URL(origin).hostname);

    const upstream = new Request(target.toString(), {
      method: request.method,
      headers,
      body: request.body,
      redirect: "manual",
    });

    return fetch(upstream);
  },
};
