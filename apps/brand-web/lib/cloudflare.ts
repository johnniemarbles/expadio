/**
 * Minimal Cloudflare DNS client for brand-domain auto-configuration.
 *
 * Given an API token (from the governed connector, never from env or request)
 * it discovers the zone that owns a domain, then idempotently creates or
 * updates each record — so re-running auto-configure converges instead of
 * duplicating. The token is used transiently and never persisted or logged.
 */

const CF_API = "https://api.cloudflare.com/client/v4";

export class CloudflareError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "CloudflareError";
    this.status = status;
  }
}

async function cf(token: string, path: string, init?: RequestInit): Promise<any> {
  let res: Response;
  try {
    res = await fetch(`${CF_API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
      cache: "no-store",
    });
  } catch (error) {
    throw new CloudflareError(`Could not reach Cloudflare: ${(error as Error).message}`, 502);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.success === false) {
    const detail = body?.errors?.[0]?.message ?? `HTTP ${res.status}`;
    const status = res.status === 401 || res.status === 403 ? 401 : res.status || 502;
    throw new CloudflareError(`Cloudflare: ${detail}`, status);
  }
  return body;
}

function candidateZones(domain: string): string[] {
  const labels = domain.split(".").filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i + 1 < labels.length; i += 1) {
    out.push(labels.slice(i).join("."));
  }
  return out.length > 0 ? out : [domain];
}

export async function findZone(token: string, domain: string): Promise<{ id: string; name: string }> {
  for (const name of candidateZones(domain)) {
    const body = await cf(token, `/zones?name=${encodeURIComponent(name)}&status=active`);
    const zone = Array.isArray(body.result) ? body.result[0] : undefined;
    if (zone?.id) return { id: zone.id, name: zone.name };
  }
  throw new CloudflareError(
    `No Cloudflare zone found for ${domain}. Add the domain to Cloudflare first, or check the token's zone access.`,
    404,
  );
}

export interface UpsertRecord {
  type: "TXT" | "MX" | "CNAME";
  name: string;
  value: string;
  priority?: number;
}

export async function upsertRecord(
  token: string,
  zoneId: string,
  record: UpsertRecord,
): Promise<{ name: string; ok: boolean; action: "created" | "updated"; detail: string }> {
  const payload = {
    type: record.type,
    name: record.name,
    content: record.value,
    ttl: 300,
    ...(record.priority !== undefined ? { priority: record.priority } : {}),
  };
  const existing = await cf(
    token,
    `/zones/${zoneId}/dns_records?type=${record.type}&name=${encodeURIComponent(record.name)}`,
  );
  const match = Array.isArray(existing.result) ? existing.result[0] : undefined;
  if (match?.id) {
    await cf(token, `/zones/${zoneId}/dns_records/${match.id}`, { method: "PUT", body: JSON.stringify(payload) });
    return { name: record.name, ok: true, action: "updated", detail: "record updated" };
  }
  await cf(token, `/zones/${zoneId}/dns_records`, { method: "POST", body: JSON.stringify(payload) });
  return { name: record.name, ok: true, action: "created", detail: "record created" };
}

/** Read back the CNAME record for a domain via the Cloudflare API (works even when proxied). */
export async function readCnameRecord(
  token: string,
  zoneId: string,
  name: string,
): Promise<string | null> {
  const body = await cf(
    token,
    `/zones/${zoneId}/dns_records?type=CNAME&name=${encodeURIComponent(name)}`,
  );
  const record = Array.isArray(body.result) ? body.result[0] : undefined;
  return typeof record?.content === 'string' ? record.content : null;
}
