type ReverificationChallenge = {
  clerk_error: { type: 'forbidden'; reason: 'reverification-error'; metadata?: unknown };
};

/** Clerk unwraps a raw Response into JSON. Keep successful/error HTTP responses
 * in an envelope so callers retain status, headers and an unread body. Only
 * the standard reverification challenge should reach its detector directly. */
export async function communicationFetchResult(response: Response): Promise<{ response: Response } | ReverificationChallenge> {
  if (response.status === 403) {
    const body = await response.clone().json().catch(() => null);
    if (body?.clerk_error?.type === 'forbidden' && body.clerk_error.reason === 'reverification-error') {
      return body as ReverificationChallenge;
    }
  }
  return { response };
}

export function requireCommunicationResponse(result: { response: Response } | ReverificationChallenge | null | undefined): Response {
  if (result && 'response' in result) return result.response;
  throw new Error('Identity verification was cancelled or is still required. The request was not completed.');
}
