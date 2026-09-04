/**
 * Cloudflare for SaaS — Custom Hostnames API client.
 *
 * Used to register/deregister tenant custom domains on the expadio.com zone
 * so Cloudflare provisions SSL automatically and routes traffic through the
 * Worker proxy. Requires CLOUDFLARE_ZONE_ID and CLOUDFLARE_API_TOKEN (with
 * Zone:SSL and Certificates:Edit + Custom Hostnames:Edit scope).
 */

const CF_API = "https://api.cloudflare.com/client/v4";

export class CloudflareSaasError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "CloudflareSaasError";
    this.status = status;
  }
}

function getPlatformCreds(): { zoneId: string; token: string } {
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!zoneId || !token) {
    throw new CloudflareSaasError(
      "CLOUDFLARE_ZONE_ID and CLOUDFLARE_API_TOKEN must be set to manage custom hostnames.",
      503,
    );
  }
  return { zoneId, token };
}

async function cfPlatform(path: string, init?: RequestInit): Promise<any> {
  const { token } = getPlatformCreds();
  let res: Response;
  try {
    res = await fetch(`${CF_API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });
  } catch (error) {
    throw new CloudflareSaasError(`Could not reach Cloudflare: ${(error as Error).message}`, 502);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.success === false) {
    const detail = body?.errors?.[0]?.message ?? `HTTP ${res.status}`;
    const status = res.status === 401 || res.status === 403 ? 401 : res.status || 502;
    throw new CloudflareSaasError(`Cloudflare: ${detail}`, status);
  }
  return body;
}

export interface CustomHostnameStatus {
  id: string;
  hostname: string;
  status: string; // 'active' | 'pending_validation' | 'pending_blocked' | etc.
  sslStatus: string | null;
}

/**
 * Create or ensure a Custom Hostname entry exists for the given tenant domain.
 * Idempotent: if the hostname already exists (by listing), it is returned as-is.
 */
export async function upsertCustomHostname(hostname: string): Promise<CustomHostnameStatus> {
  const { zoneId } = getPlatformCreds();

  // Check if already registered.
  const existing = await cfPlatform(
    `/zones/${zoneId}/custom_hostnames?hostname=${encodeURIComponent(hostname)}`,
  );
  const found = Array.isArray(existing.result) ? existing.result[0] : undefined;
  if (found?.id) {
    return {
      id: found.id,
      hostname: found.hostname,
      status: found.status ?? "unknown",
      sslStatus: found.ssl?.status ?? null,
    };
  }

  // Create new custom hostname with automatic SSL (wildcard-compatible).
  const body = await cfPlatform(`/zones/${zoneId}/custom_hostnames`, {
    method: "POST",
    body: JSON.stringify({
      hostname,
      ssl: {
        method: "http",
        type: "dv",
        settings: {
          min_tls_version: "1.2",
          http2: "on",
        },
        bundle_method: "ubiquitous",
        wildcard: false,
      },
      custom_metadata: { managed: "expadio" },
    }),
  });

  const r = body.result;
  return {
    id: r.id,
    hostname: r.hostname,
    status: r.status ?? "pending_validation",
    sslStatus: r.ssl?.status ?? null,
  };
}

/**
 * Delete the Custom Hostname registration for a tenant domain.
 * Safe to call if the hostname was never registered (no-op).
 */
export async function deleteCustomHostname(hostname: string): Promise<void> {
  const { zoneId } = getPlatformCreds();

  const existing = await cfPlatform(
    `/zones/${zoneId}/custom_hostnames?hostname=${encodeURIComponent(hostname)}`,
  );
  const found = Array.isArray(existing.result) ? existing.result[0] : undefined;
  if (!found?.id) return;

  await cfPlatform(`/zones/${zoneId}/custom_hostnames/${found.id}`, { method: "DELETE" });
}

/**
 * Get the current SSL provisioning status for a registered custom hostname.
 * Returns null if the hostname is not registered.
 */
export async function getCustomHostnameStatus(hostname: string): Promise<CustomHostnameStatus | null> {
  const { zoneId } = getPlatformCreds();

  const body = await cfPlatform(
    `/zones/${zoneId}/custom_hostnames?hostname=${encodeURIComponent(hostname)}`,
  );
  const r = Array.isArray(body.result) ? body.result[0] : undefined;
  if (!r?.id) return null;

  return {
    id: r.id,
    hostname: r.hostname,
    status: r.status ?? "unknown",
    sslStatus: r.ssl?.status ?? null,
  };
}
