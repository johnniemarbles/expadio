# EXPADIO Provider Abstraction, BYOK, BYOC and BYOD

**Status:** Frozen conceptual architecture; implementation baseline

## 1. Principle

EXPADIO owns domain contracts. Infrastructure vendors implement provider adapters.

```text
EXPADIO domain service
        ↓
Provider interface
        ↓
Provider registry / policy
        ↓
Configured adapter
        ↓
Vendor or customer infrastructure
```

## 2. Authentication

Authentication provider is replaceable.

Initial candidate/default: Clerk.

Potential alternatives include customer enterprise IdP, Auth0, Cognito, Azure/Entra-compatible OIDC/SAML and other supported identity providers.

Clerk may establish identity and organization context; EXPADIO remains authoritative for application authorization.

## 3. Database

Canonical data model: PostgreSQL.

Initial managed candidate/default: Supabase.

Supported deployment targets should be designed behind a database boundary so that customer-controlled PostgreSQL, AWS RDS, Google Cloud SQL, Azure Database for PostgreSQL or another compatible provider can be used without rewriting domain services.

## 4. Storage

Object storage is provider-neutral.

Initial managed candidate/default: Supabase Storage.

Alternative adapters: S3-compatible storage, AWS S3, Cloudflare R2, Google Cloud Storage, Azure Blob and customer-owned object storage.

## 5. Hosting

Initial deployment candidate/default: Railway.

EXPADIO must not make Railway-specific APIs part of the domain layer. Enterprise deployments can move services to AWS, GCP, Azure or customer Kubernetes/cloud infrastructure.

## 6. Communication providers

Communication remains BEMP core. Provider selection is externalized.

```text
Communication Gateway
├── Email
├── SMS
├── Voice transport
├── WhatsApp / messaging where enabled
└── Push / notification transport
```

Provider configuration can be EXPADIO-managed, BYOK or customer-owned.

## 7. AI providers

AI Gateway routes by capability, tenant policy, geography, cost and availability.

Supported provider categories include LLM, STT, TTS, embeddings, vision/OCR and specialized voice providers.

No business module may import an AI provider SDK directly.

## 8. BYOK

**Bring Your Own Key** means the customer supplies provider credentials while EXPADIO still operates the surrounding platform.

Examples:

- OpenAI key
- Gemini key
- AWS credentials
- SMTP credentials
- SMS/voice credentials
- customer storage credentials

Keys are secrets, never normal configuration data. Access must be scoped, audited and rotatable.

## 9. BYOC

**Bring Your Own Cloud** means the customer owns part or all of the infrastructure/data plane.

Three modes are supported conceptually:

### Managed

EXPADIO-managed infrastructure and default providers.

### Hybrid

Customer controls selected components such as database, storage, AI or communications.

### Customer-controlled

Customer owns the cloud/data plane while EXPADIO provides the application/platform layer.

## 10. BYOD

**Bring Your Own Data** means the customer retains ownership or hosting control of data. EXPADIO must support explicit data-residency, retention and deletion policies.

## 11. Provider registry

The Infrastructure Control Plane should manage:

- provider type
- provider
- capability
- tenant/organization scope
- credential reference
- region
- data residency
- compliance flags
- health
- priority
- fallback
- cost policy
- effective dates

## 12. Routing

Provider routing can consider:

```text
Capability
+ tenant policy
+ geography
+ residency
+ compliance
+ provider health
+ cost
+ customer preference
= provider selection
```

## 13. Failover

Provider failover must be explicit and policy-controlled. A fallback provider must not silently violate residency, compliance, consent or customer ownership requirements.

## 14. White-label

A customer may configure its own:

- domain
- email provider
- storage provider
- database/cloud deployment
- AI providers/keys
- SMS/voice providers
- branding

The user experience remains EXPADIO-powered while provider ownership can vary.

## 15. Security boundary

Provider credentials are referenced by secret identifiers. Domain entities do not receive raw credentials. Provider adapters receive only the minimum secret material required for the operation.

## 16. Migration rule

Changing a provider must be a configuration/migration concern, not a business-domain rewrite.
