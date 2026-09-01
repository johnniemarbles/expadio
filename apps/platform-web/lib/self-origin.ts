export interface PlatformSelfOriginInput {
  readonly railwayPublicDomain?: string | null;
  readonly forwardedHost?: string | null;
  readonly host?: string | null;
  readonly forwardedProto?: string | null;
  readonly fallbackPublicUrl?: string | null;
  readonly nodeEnv?: string | null;
}

function first(value?: string | null): string | null {
  const candidate = value?.split(',')[0]?.trim();
  return candidate ? candidate : null;
}

function originFromHost(host: string, protocol: string): string | null {
  if (protocol !== 'http' && protocol !== 'https') return null;
  try {
    return new URL(`${protocol}://${host}`).origin;
  } catch {
    return null;
  }
}

function fallbackOrigin(value?: string | null): string | null {
  const candidate = value?.trim();
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Resolve the origin Platform should use when a Server Component calls its own
 * API routes.
 *
 * Railway's service-specific public domain is authoritative in production. A
 * generic NEXT_PUBLIC_APP_URL is deliberately last because that variable may
 * point at another EXPADIO web surface (for example Brand) in a multi-service
 * deployment.
 */
export function resolvePlatformSelfOrigin(input: PlatformSelfOriginInput): string | null {
  const railwayDomain = first(input.railwayPublicDomain);
  if (railwayDomain) {
    const origin = originFromHost(railwayDomain.replace(/^https?:\/\//, ''), 'https');
    if (origin) return origin;
  }

  const forwardedHost = first(input.forwardedHost);
  if (forwardedHost) {
    const requestedProtocol = first(input.forwardedProto)?.replace(/:$/, '');
    const protocol = requestedProtocol === 'http' || requestedProtocol === 'https'
      ? requestedProtocol
      : forwardedHost.includes('localhost') || forwardedHost.startsWith('127.0.0.1')
        ? 'http'
        : 'https';
    const origin = originFromHost(forwardedHost, protocol);
    if (origin) return origin;
  }

  const host = first(input.host);
  if (host) {
    const protocol = host.includes('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https';
    const origin = originFromHost(host, protocol);
    if (origin) return origin;
  }

  const configuredFallback = fallbackOrigin(input.fallbackPublicUrl);
  if (configuredFallback) return configuredFallback;

  return input.nodeEnv === 'development' ? 'http://localhost:3000' : null;
}
