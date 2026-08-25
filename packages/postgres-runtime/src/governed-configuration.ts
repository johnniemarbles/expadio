import type {
  ConfigurationOverrideValidation,
  ConfigurationResolutionContext,
  ConfigurationResolutionLevel,
  ConfigurationSettingDefinition,
  ConfigurationSettingDefinitionRepository,
  ConfigurationValueCandidate,
  ConfigurationValueCandidateRepository,
} from '@expadio/business-config';
import type { PostgresClient } from './index.ts';

type OverrideValidator = NonNullable<
  ConfigurationSettingDefinition['validateOverride']
>;

interface DefinitionRow {
  readonly setting_key: string;
  readonly override_mode: ConfigurationSettingDefinition['overrideMode'];
  readonly allowed_override_levels: readonly ConfigurationResolutionLevel[];
}

interface ValueRow {
  readonly value_id: string;
  readonly level: ConfigurationResolutionLevel;
  readonly scope_id: string | null;
  readonly record_version: number;
  readonly value: unknown;
  readonly effective_from: Date | string;
  readonly evidence_refs: readonly string[];
}

/**
 * Loads the definition effective at the requested instant. Bounded behavior is
 * executable policy, so its validator must be registered in code and is never
 * reconstructed from stored JSON.
 */
export class PostgresConfigurationSettingDefinitionRepository
  implements ConfigurationSettingDefinitionRepository {
  readonly #client: PostgresClient;
  readonly #validators: ReadonlyMap<string, OverrideValidator>;

  constructor(
    client: PostgresClient,
    validators: ReadonlyMap<string, OverrideValidator> = new Map(),
  ) {
    this.#client = client;
    this.#validators = validators;
  }

  async findDefinition(
    settingKey: string,
    effectiveAt: string,
  ): Promise<ConfigurationSettingDefinition | null> {
    const result = await this.#client.query<DefinitionRow>(
      `SELECT setting_key, override_mode, allowed_override_levels
         FROM platform.configuration_setting_definitions
        WHERE setting_key = $1
          AND effective_from <= $2::timestamptz
        ORDER BY effective_from DESC, version DESC
        LIMIT 1`,
      [settingKey, effectiveAt],
    );
    const row = result.rows[0];
    if (row === undefined) return null;

    const validator = this.#validators.get(row.setting_key);
    if (row.override_mode === 'BOUNDED' && validator === undefined) {
      throw new Error(
        `CONFIGURATION_BOUND_VALIDATOR_NOT_REGISTERED:${row.setting_key}`,
      );
    }

    const definition: ConfigurationSettingDefinition = {
      settingKey: row.setting_key,
      overrideMode: row.override_mode,
      allowedOverrideLevels: [...row.allowed_override_levels],
    };
    return validator === undefined
      ? definition
      : { ...definition, validateOverride: validator };
  }
}

/** Loads only values belonging to the exact resolution context and time window. */
export class PostgresConfigurationValueCandidateRepository
  implements ConfigurationValueCandidateRepository {
  readonly #client: PostgresClient;

  constructor(client: PostgresClient) {
    this.#client = client;
  }

  async listCandidates(input: {
    readonly settingKey: string;
    readonly context: ConfigurationResolutionContext;
    readonly effectiveAt: string;
  }): Promise<readonly ConfigurationValueCandidate[]> {
    const context = input.context;
    const result = await this.#client.query<ValueRow>(
      `SELECT value_id, level, scope_id, record_version, value,
              effective_from, evidence_refs
         FROM platform.configuration_setting_values
        WHERE setting_key = $1
          AND effective_from <= $2::timestamptz
          AND (effective_until IS NULL OR effective_until > $2::timestamptz)
          AND (
            level IN ('SYSTEM_INVARIANT', 'PLATFORM')
            OR (level = 'ENVIRONMENT' AND scope_id = $3)
            OR (level = 'PLAN' AND scope_id = $4)
            OR (level = 'VERTICAL' AND scope_id = $5)
            OR (
              level = 'TENANT'
              AND tenant_id = $6::uuid
              AND scope_id = $6::text
            )
            OR (
              level = 'BRAND'
              AND tenant_id = $6::uuid
              AND scope_id = $7
            )
            OR (
              level = 'WORKSPACE'
              AND tenant_id = $6::uuid
              AND scope_id = $8
            )
            OR (
              level = 'USER_PREFERENCE'
              AND tenant_id = $6::uuid
              AND scope_id = $9
            )
            OR (
              level = 'OPERATIONAL'
              AND tenant_id = $6::uuid
              AND scope_id = $10
            )
          )
        ORDER BY effective_from ASC, record_version ASC, value_id ASC`,
      [
        input.settingKey,
        input.effectiveAt,
        context.environmentKey ?? null,
        context.planKey ?? null,
        context.verticalKey ?? null,
        context.tenantId ?? null,
        context.brandId ?? null,
        context.workspaceId ?? null,
        context.userSubjectId ?? null,
        context.operationalScopeId ?? null,
      ],
    );

    return result.rows.map((row) => {
      const candidate: ConfigurationValueCandidate = {
        level: row.level,
        recordId: row.value_id,
        version: row.record_version,
        effectiveFrom: iso(row.effective_from),
        value: row.value,
        evidenceRefs: [...row.evidence_refs],
      };
      return row.scope_id === null
        ? candidate
        : { ...candidate, scopeId: row.scope_id };
    });
  }
}

/** Reusable fail-closed validator for numeric ceilings inherited from parents. */
export function maximumNumberOverride(input: {
  readonly current: ConfigurationValueCandidate;
  readonly candidate: ConfigurationValueCandidate;
}): ConfigurationOverrideValidation {
  if (
    typeof input.current.value !== 'number'
    || typeof input.candidate.value !== 'number'
  ) {
    return {
      allowed: false,
      code: 'CONFIGURATION_LIMIT_VALUE_INVALID',
      reason: 'Both parent and candidate limits must be numbers.',
    };
  }
  if (input.candidate.value > input.current.value) {
    return {
      allowed: false,
      code: 'CONFIGURATION_PARENT_LIMIT_EXCEEDED',
      reason: 'A lower scope cannot exceed its effective parent limit.',
    };
  }
  return {
    allowed: true,
    code: 'CONFIGURATION_WITHIN_PARENT_LIMIT',
    reason: 'The candidate remains within its effective parent limit.',
  };
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
