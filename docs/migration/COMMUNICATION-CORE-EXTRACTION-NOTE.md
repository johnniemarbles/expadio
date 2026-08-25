# Communication Core Extraction Note

## Source

Primary source: `johnniemarbles/BEMP/apps/core/src/communication`.

Verified source behaviors retained in the first EXPADIO communication slice:

- provider-neutral channel and purpose semantics
- mandatory tenant and idempotency identifiers
- explicit marketing-consent enforcement
- deterministic recipient-key derivation for suppression/idempotency
- refusal/reason-code model
- conversation ownership that can be human, AI or system
- inbound/outbound conversation message semantics

## Deliberate normalization

The EXPADIO contract does **not** copy provider configuration unions containing API keys, auth tokens, passwords or private keys. Provider credentials remain behind the existing Provider Registry + external SecretResolver boundary.

`brandId` is not promoted into the generic core contract. EXPADIO uses optional `organizationId`; vertical/brand context is resolved outside the communication primitive.

Push targets use an opaque EXPADIO `pushEndpointId` or subject identity. Raw provider device tokens are not part of the business-domain request contract.

## Not included in this slice

- database persistence
- templates
- suppression persistence
- provider routing integration
- webhooks
- retry/delivery state machine
- email sending domains/sender identities
- voice call orchestration
- provider SDK adapters

Those remain separate small gated slices.
