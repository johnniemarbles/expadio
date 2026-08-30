import { timingSafeEqual } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class InternalWorkerAuthError extends Error {
  readonly status: number;
  readonly reasonCode: string;

  constructor(status: number, reasonCode: string, message: string) {
    super(message);
    this.name = 'InternalWorkerAuthError';
    this.status = status;
    this.reasonCode = reasonCode;
  }
}

function secureEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function authenticateInternalWorkerToken(request: Request): void {
  const configuredToken = process.env.EXPADIO_INTERNAL_WORKER_TOKEN?.trim() ?? '';
  if (configuredToken === '') {
    throw new InternalWorkerAuthError(
      503,
      'INTERNAL_WORKER_DISABLED',
      'Internal worker execution is not configured.',
    );
  }

  const authorization = request.headers.get('authorization') ?? '';
  const prefix = 'Bearer ';
  const suppliedToken = authorization.startsWith(prefix)
    ? authorization.slice(prefix.length).trim()
    : '';

  if (suppliedToken === '' || !secureEqual(suppliedToken, configuredToken)) {
    throw new InternalWorkerAuthError(
      401,
      'INTERNAL_WORKER_UNAUTHORIZED',
      'Internal worker authentication failed.',
    );
  }
}

export function parseInternalWorkerTenantId(value: unknown): string {
  const tenantId = typeof value === 'string' ? value.trim() : '';
  if (!UUID.test(tenantId)) {
    throw new InternalWorkerAuthError(
      400,
      'INTERNAL_WORKER_TENANT_REQUIRED',
      'A valid tenant UUID is required.',
    );
  }
  return tenantId;
}

export function authenticateInternalWorkerRequest(
  request: Request,
): { readonly tenantId: string } {
  authenticateInternalWorkerToken(request);
  return {
    tenantId: parseInternalWorkerTenantId(
      request.headers.get('x-expadio-tenant-id'),
    ),
  };
}
