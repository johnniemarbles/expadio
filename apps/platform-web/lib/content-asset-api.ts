import { NextResponse } from 'next/server';
import { ContentAssetValidationError } from '@expadio/storage';
import { deniedResponse } from './request-context';

const noStore = { 'Cache-Control': 'private, no-store' };

export function contentAssetJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: noStore });
}

export function contentAssetForbidden(): NextResponse {
  return contentAssetJson({
    denied: true,
    reasonKey: 'FORBIDDEN',
    message: 'Content asset administration requires a tenant administrator role.',
  }, 403);
}

export function contentAssetError(error: unknown): NextResponse {
  if (error instanceof ContentAssetValidationError) {
    return contentAssetJson({
      reasonKey: error.code,
      message: error.message,
      field: error.field,
    }, 400);
  }
  if (error instanceof Error) {
    if (/NOT_FOUND|NOT_QUARANTINED|NOT_AVAILABLE/.test(error.message)) {
      return contentAssetJson({
        reasonKey: error.message,
        message: 'The requested content asset is not available in this state.',
      }, 404);
    }
    if (/DIGEST_MISMATCH|BYTE_LENGTH_MISMATCH|UPLOAD_LENGTH_MISMATCH/.test(error.message)) {
      return contentAssetJson({
        reasonKey: 'CONTENT_ASSET_BINARY_MISMATCH',
        message: 'The uploaded bytes do not match the registered asset.',
      }, 400);
    }
    if (/NOT_PENDING_UPLOAD|INVALID_STATE_TRANSITION|IDEMPOTENCY_CONFLICT/.test(error.message)) {
      return contentAssetJson({
        reasonKey: error.message,
        message: 'The content asset conflicts with its current lifecycle state.',
      }, 409);
    }
    if (/CONFIGURATION_MISSING|PROVIDER_FAILED|CREDENTIAL_UNAVAILABLE|BUCKET_VERIFICATION_FAILED|SCAN_RESPONSE_INVALID|SCAN_IDENTITY_MISMATCH|SCAN_VERIFICATION_MISMATCH/.test(error.message)) {
      return contentAssetJson({
        denied: true,
        reasonKey: 'CONTENT_ASSET_SERVICE_UNAVAILABLE',
        message: 'Content asset processing is temporarily unavailable.',
      }, 503);
    }
  }
  const denied = deniedResponse(error);
  return contentAssetJson(denied.body, denied.status);
}
