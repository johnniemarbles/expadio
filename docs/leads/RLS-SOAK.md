# Lead capture RLS soak

Gate 1 for merging `expadio-lead-management` into EXPADIO. Not a substitute for running it.

## Cluster

Use the EXPADIO Postgres with FORCE RLS. Apply extract `0001_foundation.sql` + `0002_layers.sql` on a scratch schema or a dedicated lab database. Apply platform `0086_lead_capture_convert_seam.sql` on `platform.crm_leads`.

Set session GUCs the same way production does:

```sql
SELECT set_config('app.tenant_id', '<tenant-a-uuid>', true);
-- optional extract fence
SELECT set_config('app.visible_layer_ids', 'hq,in,in-tn,in-tn-u1', true);
```

## Fixtures

- Tenant A brand B1: HQ → IN → TN → unit U1, and HQ → US.
- Tenant A brand B2: sibling brand, same email inbound.
- Tenant B: unrelated tenant, same email inbound.
- Grants: HQ `SELF_AND_DESCENDANTS`; IN country `SELF_AND_DESCENDANTS`; U1 `SELF` only.

## Must pass

| Check | Expected |
| --- | --- |
| Tenant A session reads Tenant B `platform.crm_leads` | 0 rows |
| Same email on B1 and B2 | two CRM rows |
| IN grant reads US layer capture | 0 rows |
| HQ grant reads U1 capture | ≥1 row |
| Convert twice with same `capture_lead_id` | one `platform.crm_leads` row |
| After convert, extract capture row | still present |

`SELECT * FROM platform.lead_capture_soak_expectations();` is the machine-readable list.

## Out of scope this soak

OTP, CSV import, lab HTTP server, BEMP routes, social send, AutoGTM dispatch.
