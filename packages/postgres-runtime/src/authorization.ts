import type {
  AuthorizationRestriction,
  CapabilityGrant,
  DataClassification,
  RoleAssignment,
  ScopeGrant,
} from '@expadio/authorization';
import type {
  AuthorizationPolicy,
  AuthorizationPolicyRepository,
} from '@expadio/authorization-persistence';
import type { EffectiveContext } from '@expadio/tenancy';
import type { PostgresClient } from './index.ts';

interface AssignmentCapabilityRow {
  readonly assignment_id: string;
  readonly organization_id: string | null;
  readonly role_key: string;
  readonly action_organization_ids: readonly string[] | null;
  readonly action_operating_unit_ids: readonly string[] | null;
  readonly action_resource_ids: readonly string[] | null;
  readonly visibility_organization_ids: readonly string[] | null;
  readonly visibility_operating_unit_ids: readonly string[] | null;
  readonly visibility_resource_ids: readonly string[] | null;
  readonly clearances: readonly DataClassification[];
  readonly sensitive_compartments: readonly string[];
  readonly action: string;
  readonly resource_type: string;
  readonly blocked_states: readonly string[];
}

interface RestrictionRow {
  readonly restriction_key: string;
  readonly action: string | null;
  readonly resource_type: string | null;
  readonly resource_id: string | null;
  readonly reason: string;
}

interface AssignmentAccumulator {
  readonly roleKey: string;
  readonly capabilities: CapabilityGrant[];
  readonly actionScope: ScopeGrant;
  readonly visibilityScope?: ScopeGrant;
  readonly clearances: readonly DataClassification[];
  readonly sensitiveCompartments: readonly string[];
}

export class PostgresAuthorizationPolicyRepository implements AuthorizationPolicyRepository {
  readonly #client: PostgresClient;

  /** The client must already be bound to the verified EffectiveContext transaction. */
  constructor(client: PostgresClient) {
    this.#client = client;
  }

  async loadPolicy(context: EffectiveContext): Promise<AuthorizationPolicy> {
    const assignments = await this.#loadAssignments(context);
    const restrictions = await this.#loadRestrictions(context);
    return { assignments, restrictions };
  }

  async #loadAssignments(context: EffectiveContext): Promise<readonly RoleAssignment[]> {
    const result = await this.#client.query<AssignmentCapabilityRow>(
      `SELECT
         a.assignment_id,
         a.organization_id,
         r.role_key,
         a.action_organization_ids,
         a.action_operating_unit_ids,
         a.action_resource_ids,
         a.visibility_organization_ids,
         a.visibility_operating_unit_ids,
         a.visibility_resource_ids,
         a.clearances,
         a.sensitive_compartments,
         c.action,
         c.resource_type,
         c.blocked_states
       FROM platform.authorization_assignments a
       JOIN platform.authorization_roles r ON r.role_id = a.role_id
       JOIN platform.authorization_role_capabilities c ON c.role_id = r.role_id
       WHERE a.tenant_id = $1::uuid
         AND a.subject_id = $2
         AND a.status = 'ACTIVE'
         AND r.status = 'ACTIVE'
         AND a.valid_from <= now()
         AND (a.valid_until IS NULL OR a.valid_until > now())
         AND (a.organization_id IS NULL OR a.organization_id = $3::uuid)
       ORDER BY a.assignment_id, c.action, c.resource_type`,
      [context.tenantId, context.subjectId, context.organizationId],
    );

    const grouped = new Map<string, AssignmentAccumulator>();
    for (const row of result.rows) {
      let assignment = grouped.get(row.assignment_id);
      if (assignment === undefined) {
        const actionScope = scopeFromRow(
          context.tenantId,
          row.organization_id,
          row.action_organization_ids,
          row.action_operating_unit_ids,
          row.action_resource_ids,
        );
        const visibilityScope = optionalVisibilityScope(
          context.tenantId,
          row.organization_id,
          row.visibility_organization_ids,
          row.visibility_operating_unit_ids,
          row.visibility_resource_ids,
        );
        assignment = {
          roleKey: row.role_key,
          capabilities: [],
          actionScope,
          ...(visibilityScope !== undefined ? { visibilityScope } : {}),
          clearances: [...row.clearances],
          sensitiveCompartments: [...row.sensitive_compartments],
        };
        grouped.set(row.assignment_id, assignment);
      }
      assignment.capabilities.push({
        action: row.action,
        resourceType: row.resource_type,
        ...(row.blocked_states.length > 0 ? { blockedStates: [...row.blocked_states] } : {}),
      });
    }

    return [...grouped.values()].map((assignment) => ({
      roleKey: assignment.roleKey,
      capabilities: assignment.capabilities,
      actionScope: assignment.actionScope,
      ...(assignment.visibilityScope !== undefined
        ? { visibilityScope: assignment.visibilityScope }
        : {}),
      clearances: assignment.clearances,
      sensitiveCompartments: assignment.sensitiveCompartments,
    }));
  }

  async #loadRestrictions(
    context: EffectiveContext,
  ): Promise<readonly AuthorizationRestriction[]> {
    const result = await this.#client.query<RestrictionRow>(
      `SELECT restriction_key, action, resource_type, resource_id, reason
       FROM platform.authorization_restrictions
       WHERE tenant_id = $1::uuid
         AND subject_id = $2
         AND status = 'ACTIVE'
         AND valid_from <= now()
         AND (valid_until IS NULL OR valid_until > now())
       ORDER BY restriction_key, restriction_id`,
      [context.tenantId, context.subjectId],
    );

    return result.rows.map((row) => ({
      key: row.restriction_key,
      ...(row.action !== null ? { action: row.action } : {}),
      ...(row.resource_type !== null ? { resourceType: row.resource_type } : {}),
      ...(row.resource_id !== null ? { resourceId: row.resource_id } : {}),
      reason: row.reason,
    }));
  }
}

function scopeFromRow(
  tenantId: string,
  assignmentOrganizationId: string | null,
  organizationIds: readonly string[] | null,
  operatingUnitIds: readonly string[] | null,
  resourceIds: readonly string[] | null,
): ScopeGrant {
  const boundedOrganizations = boundOrganizations(assignmentOrganizationId, organizationIds);
  return {
    tenantId,
    ...(boundedOrganizations !== null ? { organizationIds: boundedOrganizations } : {}),
    ...(operatingUnitIds !== null ? { operatingUnitIds: [...operatingUnitIds] } : {}),
    ...(resourceIds !== null ? { resourceIds: [...resourceIds] } : {}),
  };
}

function optionalVisibilityScope(
  tenantId: string,
  assignmentOrganizationId: string | null,
  organizationIds: readonly string[] | null,
  operatingUnitIds: readonly string[] | null,
  resourceIds: readonly string[] | null,
): ScopeGrant | undefined {
  if (
    assignmentOrganizationId === null &&
    organizationIds === null &&
    operatingUnitIds === null &&
    resourceIds === null
  ) {
    return undefined;
  }
  return scopeFromRow(
    tenantId,
    assignmentOrganizationId,
    organizationIds,
    operatingUnitIds,
    resourceIds,
  );
}

function boundOrganizations(
  assignmentOrganizationId: string | null,
  organizationIds: readonly string[] | null,
): readonly string[] | null {
  if (assignmentOrganizationId === null) {
    return organizationIds === null ? null : [...organizationIds];
  }
  if (organizationIds === null) return [assignmentOrganizationId];
  return organizationIds.includes(assignmentOrganizationId) ? [assignmentOrganizationId] : [];
}
