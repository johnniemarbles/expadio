'use client';

import { useReverification } from '@clerk/nextjs';
import { communicationFetchResult, requireCommunicationResponse } from './communication-fetch-result';

/** Preserve HTTP responses through Clerk's challenge detector.
 * Accept repeatable URL + init requests, never a consumed Request body.
 * The server rejects stale authentication before any mutation, so only that
 * request is retried; successful intake is not replayed by registration. */
export function useCommunicationFetch() {
  const reverifiedFetch = useReverification(async (url: string, init?: RequestInit) =>
    communicationFetchResult(await fetch(url, init)));
  return async (url: string, init?: RequestInit): Promise<Response> => {
    const response = await reverifiedFetch(url, init);
    return requireCommunicationResponse(response);
  };
}
