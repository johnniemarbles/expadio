/**
 * @expadio/lead-capture
 *
 * The shared, transport-agnostic submission contract for Demand Capture, plus
 * the client SDK for both trust rails:
 *   - contract / normalize  the canonical payload shape and its validation
 *   - interest-payload      typed Tier 1 + Tier 2 commercial-interest fields
 *   - client                the PUBLIC (browser) rail: publishable key + Origin
 *   - sign                  the SIGNED (server) rail: Ed25519 over the raw body
 *
 * The embed snippet is a separate entry (`@expadio/lead-capture/embed`) so a
 * server bundle never pulls DOM code.
 */
export * from './contract.ts';
export * from './interest-payload.ts';
export * from './interest-type-registry.ts';
export * from './capture-source-config.ts';
export * from './normalize.ts';
export * from './public-source.ts';
export * from './client.ts';
export * from './sign.ts';
export * from './lead-management-config.ts';
export * from './governance-escalation.ts';
export * from './qualification-provenance.ts';
export * from './evidence-profile.ts';
export * from './commercial-opportunity-pack.ts';
export * from './publication.ts';
