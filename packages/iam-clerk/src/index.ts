import { verifyToken } from '@clerk/backend';
import type { 
  IdentityVerifier, 
  IdentityVerificationRequest, 
  VerifiedIdentity
} from '@expadio/iam';
import { IdentityVerificationError as IAMError } from '@expadio/iam';

export interface ClerkVerifierOptions {
  readonly secretKey: string;
  readonly jwtKey?: string;
  readonly authorizedParties?: readonly string[];
}

export class ClerkIdentityVerifier implements IdentityVerifier {
  constructor(private readonly options: ClerkVerifierOptions) {}

  async verify(request: IdentityVerificationRequest): Promise<VerifiedIdentity> {
    try {
      const verifyOptions: any = {
        secretKey: this.options.secretKey,
      };
      if (this.options.jwtKey !== undefined) verifyOptions.jwtKey = this.options.jwtKey;
      if (this.options.authorizedParties !== undefined) verifyOptions.authorizedParties = this.options.authorizedParties;
      if (request.expectedAudience !== undefined) verifyOptions.audience = request.expectedAudience;

      const payload = await verifyToken(request.credential, verifyOptions);

      const identity: any = {
        providerKey: 'clerk',
        subjectId: payload.sub,
        issuer: payload.iss,
        actorKind: 'user', // Default to user for Clerk integrations
      };

      if (payload.aud !== undefined) {
        identity.audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
      }
      if (payload.iat !== undefined) {
        identity.issuedAt = new Date(payload.iat * 1000);
      }
      if (payload.exp !== undefined) {
        identity.expiresAt = new Date(payload.exp * 1000);
      }
      if (payload.sid !== undefined) {
        identity.sessionId = payload.sid as string;
      }

      return identity as VerifiedIdentity;
    } catch (error: any) {
      if (error?.reason === 'token-expired') {
        throw new IAMError('IDENTITY_EXPIRED');
      }
      throw new IAMError('INVALID_NORMALIZED_IDENTITY');
    }
  }
}
