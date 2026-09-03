// Brand consumes the shared Lead scoring domain directly from the workspace source.
// This is a thin module-boundary bridge only; no scoring rules or calculations are
// duplicated in Brand. Keep business logic in packages/lead/src/scoring.ts.
export * from '../../../packages/lead/src/scoring.ts';
