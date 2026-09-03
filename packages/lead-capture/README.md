# @expadio/lead-capture

The shared **submission payload contract** and **client SDK** for Demand Capture.
One canonical payload, produced by every surface (embedded form, SDK, hosted
landing page, inbound adapters) and consumed by the ingress. Two trust rails:

| Rail | Who | How it authenticates | Entry point |
|---|---|---|---|
| **PUBLIC** | browsers (embedded form, widget, landing page) | publishable key + Origin allowlist, then server-side OTP | `createBrowserCaptureClient` |
| **SIGNED** | trusted servers, inbound-channel adapters | Ed25519 signature over the raw body | `createServerCaptureClient` |

A client **never** asserts tenant, organization, layer or stage — those come from
the source row the key/signature resolves to. The contract shape omits them by
construction.

## Embedded website form (PUBLIC rail)

One form, data attributes, one script. No secret in the page — the publishable
key (`cpk_…`) authorizes nothing on its own.

```html
<form data-expadio-capture
      data-base-url="https://api.expadio.com"
      data-tenant-id="TENANT_UUID"
      data-source-id="SOURCE_UUID"
      data-publishable-key="cpk_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX">
  <input name="email" type="email" required />
  <input name="firstName" /> <input name="lastName" />
  <input name="phone" /> <input name="company" />
  <input data-field="investment_range" name="investment_range" />
  <!-- bot trap: keep hidden; a filled value is silently discarded -->
  <input data-expadio-honeypot name="company_website" tabindex="-1" autocomplete="off" aria-hidden="true" />
  <button type="submit">Request info</button>
</form>

<script type="module">
  import { autoMountCaptureForms } from '@expadio/lead-capture/embed';
  autoMountCaptureForms();
</script>
```

The form emits `expadio:capture:success` (detail: the capture result) and
`expadio:capture:error` (detail: `{ message }`). `requiresVerification: true`
means the lead is captured but parked awaiting OTP — do not treat it as complete.

## SDK — browser (PUBLIC rail)

```ts
import { createBrowserCaptureClient } from '@expadio/lead-capture';

const capture = createBrowserCaptureClient({
  baseUrl: 'https://api.expadio.com',
  tenantId: 'TENANT_UUID',   // public routing coordinates, not secrets
  sourceId: 'SOURCE_UUID',
  publishableKey: 'cpk_…',   // safe to ship to the browser
});

// UTM/referrer/page URL are captured from the page automatically.
const { captureLeadId, requiresVerification } = await capture.submit({
  contact: { email: 'lead@example.com', firstName: 'Ada', phone: '+1 415 555 0000' },
  organization: { name: 'Analytical Engines' },
  consent: [{ channel: 'EMAIL', purpose: 'MARKETING', granted: true, textVersion: 'v3' }],
  fields: { investment_range: '50k-100k' },
});

// requiresVerification === true: the lead is captured but PARKED. Collect the
// emailed code and complete the OTP gate to admit it to the pipeline.
if (requiresVerification && captureLeadId) {
  const { verified } = await capture.verify(captureLeadId, '123456');
}
```

The endpoints exist: `POST /api/lead-capture/public/{sourceId}?tenantId=…` (ingress)
and `.../verify` (OTP). OTP *delivery* over Communications is wired in the next
step, so `verify` cannot complete in production until then.

## SDK — server (SIGNED rail)

For your own backend, a landing-page server, or an inbound-channel adapter. The
**private** key stays on the server; the matching public key sits on the source.

```ts
import { createServerCaptureClient } from '@expadio/lead-capture';

const capture = createServerCaptureClient({
  baseUrl: 'https://api.expadio.com',
  tenantId: process.env.EXPADIO_TENANT_ID!,
  sourceId: process.env.EXPADIO_SOURCE_ID!,
  privateKeyPkcs8Pem: process.env.EXPADIO_CAPTURE_PRIVATE_KEY!, // Ed25519 PKCS#8 PEM
});

await capture.submit({ contact: { email: 'lead@example.com' } });
```

`signCaptureBody` is exported for adapters that build the request themselves; it
produces exactly the headers the live ingress verifies
(`${timestamp}.${rawBody}`), proven by `test/sign.test.ts` against `node:crypto`.

## What this package is not

- **Not** the ingress. The PUBLIC endpoint, its OTP gate, origin enforcement and
  RLS ship with the Rail B route (next step); this package is the contract and
  the clients that talk to both rails.
- **Not** identity resolution. `normalizeEmail`/`normalizePhone` only tidy values
  for storage; canonical matching and dedup are the identity engine's job.
