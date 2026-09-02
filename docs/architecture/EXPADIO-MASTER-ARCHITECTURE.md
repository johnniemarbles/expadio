# EXPADIO Master Architecture

**Status:** Frozen conceptual architecture; implementation baseline

## 1. Mission

EXPADIO is the master platform for building and operating industry-specific business experiences from a common business-expansion backbone. BEMP is the core business engine. Vertical products specialize the platform without duplicating the core.

## 2. Architectural hierarchy

```text
EXPADIO
├── BEMP Core Engine
│   ├── Identity context
│   ├── Organizations / tenancy
│   ├── Business configuration
│   ├── CRM / people / organizations
│   ├── Leads / demand
│   ├── Cases / agreements
│   ├── Workflow / Decision Fabric
│   ├── Assignment
│   ├── Communication
│   │   ├── Email / SMS / messaging / push
│   │   ├── Voice transport
│   │   ├── Notifications
│   │   ├── Conversations / unified inbox
│   │   ├── Templates / campaigns / automation
│   │   └── Delivery tracking / provider routing
│   ├── Entitlements
│   ├── Compliance / governance primitives
│   └── Audit / provenance
│
├── Data & Intelligence Layer
│   ├── Event / data orchestration
│   ├── AI gateway
│   ├── Voice gateway
│   ├── Extraction / enrichment
│   ├── Context engine
│   ├── Knowledge / retrieval
│   ├── Agent runtime
│   ├── AI jobs / cost accounting
│   └── AI governance
│
├── Horizontal Modules
│   ├── LMS
│   ├── Professional Community
│   ├── Jobs
│   └── Marketplace
│
 ├── Industry Packs / Verticals
 │   │
 │   │   Industry Packs are authored by Platform operators or by tenant brands.
 │   │   There are no built-in vertical packages; each brand/tenant configures its
 │   │   own domain vocabulary (terminology, case schema, workflow stages, and
 │   │   ontology roles) as a published pack. Examples live in
 │   │   docs/reference/experiments/ (DENTEX, WeRealtors) as tenant reference
 │   │   implementations — not as platform code.
 │   │
 │   └── (any brand onboards as a tenant and authors its own pack)
│
└── Experience Channels
    ├── Public
    ├── Platform
    ├── Brand
    ├── Client
    ├── Partner
    ├── Web
    ├── Mobile
    ├── API / SDK
    ├── Embedded
    └── AI Agent
```

Notification delivery is owned by BEMP Communication. A vertical or horizontal module may emit notification intents, but it must not implement a competing notification transport, provider-routing or delivery-tracking engine.

## 3. Business-neutral domain model

The platform must not hard-code vertical vocabulary into core services.

```text
Business Model
  ├── Industry
  ├── Ontology
  │   ├── People
  │   ├── Organizations
  │   └── Business Objects
  ├── Terminology
  ├── Personas
  ├── Functional Roles
  ├── Relationships
  ├── Teams / Queues
  ├── Skills
  ├── Certifications
  ├── Policies
  ├── Entitlements
  ├── Workflows
  ├── Assignment Rules
  └── Lifecycles
```

Persona, functional role and relationship are deliberately separate concepts. A dental clinic `Dentist`, a real-estate `Broker` and a logistics `Driver` can be industry-specific labels over neutral person/relationship primitives — authored by each brand tenant as an Industry Pack.

## 4. Authorization

Authorization is an EXPADIO responsibility. Authentication is delegated to a provider.

```text
Authenticated identity
  + organization context
  + persona
  + role
  + relationship
  + territory / scope
  + resource
  + policy
  + entitlement
  = authorization decision
```

Use RBAC, ABAC and relationship/context checks together. Provider roles must never become the canonical EXPADIO authorization model.

## 5. Workflow and assignment

Do not create a second workflow engine inside verticals. BEMP Decision Fabric remains the workflow execution backbone.

Assignment targets can be:

- user
- role
- team
- queue
- organization
- territory
- skill/certification cohort
- AI agent

Assignment strategies can include deterministic rules, round-robin, workload, skill, availability, territory and escalation.

## 6. AI and voice

AI is a platform intelligence layer. AI operations execute within the same identity, policy, workflow, entitlement and audit boundaries as human actions.

AI may recommend or extract; sensitive state changes must pass deterministic validation and business policy before mutation.

## 7. Data principles

PostgreSQL is the canonical relational domain model. Provider implementations must sit behind interfaces so that Supabase can be replaced by customer PostgreSQL, AWS RDS, Cloud SQL, Azure Database for PostgreSQL or other supported deployments.

Object storage follows the same pattern.

## 8. Experience model

Audience and channel are different dimensions.

**Audiences:** Public, Platform, Brand, Client, Partner.

**Channels:** Web, Mobile, API, SDK, Embedded, AI Agent.

Mobile is therefore another client experience over the same EXPADIO API, not a second backend.

## 9. Infrastructure portability

EXPADIO supports three operating modes:

1. **Managed:** EXPADIO-managed defaults.
2. **Hybrid:** customer supplies selected providers/keys.
3. **Customer-controlled:** customer owns cloud/data plane and EXPADIO supplies the application/platform layer.

This is implemented through the Provider Gateway and Infrastructure Control Plane.

## 10. Vertical boundary rule

A vertical may own:

- industry ontology definitions
- terminology
- domain-specific business objects
- vertical workflows
- vertical compliance rules
- vertical UI modules
- vertical integrations

A vertical must not fork core identity, authorization, communication, workflow, event, AI gateway, provider abstraction or audit infrastructure without an explicit architecture decision.

## 11. Repository target shape

```text
apps/
  public-web/
  platform-web/
  brand-web/
  client-web/
  partner-web/
  mobile/
  api/

packages/
  domain/
  iam/
  authorization/
  tenancy/
  business-config/
  crm/
  leads/
  cases/
  workflows/
  decision-fabric/
  assignment/
  communication/
  ai-gateway/
  voice-gateway/
  data-orchestrator/
  extraction/
  context-engine/
  knowledge/
  agent-runtime/
  provider-gateway/
  storage/
  audit/
  observability/
  ui/
  sdk/

modules/
  lms/
  community/
  jobs/
  marketplace/

verticals/
  (removed — DENTEX and WeRealtors are now in docs/reference/experiments/
   as tenant reference implementations, not platform code)

infrastructure/
  migrations/
  deployment/
  providers/

architecture/
docs/
```

The exact package split is subject to repository extraction findings; this document defines the boundary principles, not a license to create hundreds of packages prematurely.

## 12. Non-negotiable engineering rules

- No vertical-specific authentication implementation in core.
- No direct AI-provider SDK calls from business modules.
- No direct SMS/email/voice provider calls from business modules.
- No direct storage-provider dependency from business modules.
- No AI agent unrestricted database access.
- Every AI-derived mutation requires provenance and policy enforcement.
- Every provider credential is tenant/organization scoped as appropriate and secret-managed.
- Configuration is versioned and auditable.
- Data residency and retention are explicit configuration dimensions.
- Public access is intentional, scoped and auditable where applicable.
- All core APIs are reusable by web, mobile, embedded clients and agents.
