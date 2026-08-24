# EXPADIO AI, Data Intelligence and Voice Architecture

**Status:** Frozen conceptual architecture; implementation baseline

## 1. Objective

AI is a first-class EXPADIO capability shared by every vertical. Voice, STT, TTS, extraction, enrichment, RAG, agents and CRM intelligence are platform services, not vertical-specific features.

## 2. Layered architecture

```text
AI / VOICE EXPERIENCE
        ↓
AI Agent / Conversation Runtime
        ↓
Context Engine
        ↓
AI Orchestrator
        ↓
AI Gateway / Voice Gateway / Extraction
        ↓
Provider adapters
        ↓
OpenAI / Gemini / Anthropic / Azure / Deepgram / ElevenLabs / Google / AWS / customer providers
```

## 3. AI Gateway

Expose provider-neutral operations such as:

- generate
- classify
- summarize
- extract
- embed
- rerank
- vision/analyze
- translate

Business modules must call the gateway interface rather than importing provider SDKs directly.

## 4. Voice Gateway

Voice is composed of communication transport plus intelligence.

```text
Telephony / Voice transport
  ↓
Audio stream
  ↓
STT
  ↓
Conversation / agent runtime
  ↓
Context + policy
  ↓
Business action / response
  ↓
TTS
  ↓
Telephony / Voice transport
```

Capabilities include STT, TTS, streaming conversation, call transcription, speaker metadata, intent/entity extraction, sentiment where appropriate, call summary, disposition and follow-up generation.

## 5. Data & Intelligence Orchestrator

The orchestrator coordinates asynchronous intelligence work:

- event ingestion
- extraction
- transformation
- entity resolution
- enrichment
- classification
- embeddings
- indexing
- workflow triggers
- AI jobs
- CRM projections
- audit/provenance

Example:

```text
Email / call / document / form
        ↓
Event
        ↓
Data Orchestrator
        ↓
Extract + resolve + enrich
        ↓
Validate against ontology
        ↓
Apply policy
        ↓
Create/update CRM object
        ↓
Trigger workflow
```

## 6. AI must not mutate CRM directly

AI output is an observation/proposal until validated.

```text
AI extraction
  ↓
Structured result
  ↓
Confidence + provenance
  ↓
Schema validation
  ↓
Policy evaluation
  ↓
Human approval where required
  ↓
BEMP command / workflow mutation
```

This is mandatory for regulated and high-impact domains.

## 7. AI Context Engine

Context resolution can include:

- authenticated identity
- organization
- tenant
- persona
- role
- relationships
- territory
- CRM record
- case
- workflow state
- entitlements
- policies
- documents/knowledge
- communication history
- relevant business events

Context retrieval must obey the same authorization boundary as the requesting user or agent.

## 8. Agent Runtime

Agents are first-class workflow participants with:

- agent identity
- role
- scope
- permissions
- tools
- knowledge sources
- budget
- model/provider policy
- retention policy
- audit trail

Tool invocation must pass EXPADIO authorization before execution.

## 9. AI tools

Examples:

- search_leads
- get_person
- get_organization
- search_cases
- create_task
- send_email
- send_sms
- initiate_call
- schedule_appointment
- search_knowledge
- create_workflow_action

Agents do not receive unrestricted database credentials.

## 10. AI Jobs

Long-running AI operations are represented as durable jobs.

Each job tracks:

- job id
- tenant / organization
- purpose
- provider
- model
- input reference
- output reference
- status
- retries
- latency
- token/audio usage
- cost
- confidence
- provenance
- workflow/case linkage
- audit timestamps

## 11. AI governance

Every AI operation should retain enough metadata to answer:

- which provider and model ran?
- which prompt/configuration version?
- what source data was used?
- what output was generated?
- what confidence was assigned?
- what policy allowed the action?
- was a human involved?
- what did it cost?
- where was data processed?
- what retention rule applies?

## 12. Voice governance

Voice-enabled deployments must support configuration for:

- recording consent
- recording retention
- transcript retention
- PII/PHI redaction
- jurisdiction
- data residency
- provider
- voice model
- caller disclosure where required
- human escalation

## 13. CRM intelligence

AI may generate structured intelligence such as:

- lead intent
- engagement score
- sentiment
- summary
- next-best action
- recommended owner
- risk signal
- extracted fields
- relationship insights

These are stored with provenance and confidence and can trigger BEMP workflows.

## 14. Knowledge engine

RAG/knowledge is a shared service with:

- document ingestion
- chunking
- embeddings
- metadata
- access-control filters
- versioning
- retention
- citations/provenance
- re-indexing

Vertical knowledge is isolated by tenant/industry/entitlement while using the same engine.

## 15. Cost governance

AI and voice usage is metered by tenant/organization/provider/model/job.

The platform should support:

- budgets
- soft alerts
- hard limits
- provider routing
- model routing
- cost dashboards
- BYOK cost attribution
- customer-owned provider billing

## 16. Human-in-the-loop

Workflows can require human approval for sensitive actions. AI recommendation and deterministic authorization are separate decisions.

```text
AI recommendation
      ↓
Policy
      ↓
Human approval if required
      ↓
Workflow transition
      ↓
Audited mutation
```
