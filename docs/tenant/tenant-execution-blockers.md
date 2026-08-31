# Tenant execution blockers found

Audit of the branch's existing APIs found one important blocker before wiring live tenant actions:

- POST /api/governance/reviews currently inserts REVIEW_DECISION_SIMULATED and returns simulated: true.
- The route resolves a hard-coded tenant and organization fallback instead of deriving the selected tenant scope from the request context.
- Therefore the tenant UI must not call this endpoint as a real Approve/Request changes command.

Required correction before live tenant actions:

1. Resolve authenticated tenant, brand and location context from membership and request scope.
2. Use a persisted decision/approval command with authorization and maker/approver separation.
3. Return the persisted state and correlation/audit reference.
4. Make replay idempotent and expose uncertain outcomes.
5. Add denial and cross-scope tests.

The model tenant UI remains fixture-only until this boundary is corrected. This keeps the tenant experience honest and avoids presenting a simulated mutation as production execution.
