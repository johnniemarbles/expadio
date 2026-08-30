import type { PoolClient } from 'pg';
import {
  DENTEX_TREATMENT_URGENCIES,
  type DentexTreatmentAttributes,
  type DentexTreatmentStage,
  type DentexTreatmentUrgency,
  type DentexTreatmentWorkspace,
} from '@expadio/dentex';

interface TreatmentProjectionRow {
  readonly case_id: string;
  readonly tenant_id: string;
  readonly account_id: string | null;
  readonly contact_id: string | null;
  readonly subject: string;
  readonly description: string | null;
  readonly priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  readonly status: 'OPEN' | 'PENDING' | 'RESOLVED' | 'CLOSED';
  readonly stage_key: string | null;
  readonly owner_subject_id: string | null;
  readonly attributes: Record<string, unknown> | null;
  readonly attributes_schema_version: number | null;
  readonly industry_pack_vertical_key: string | null;
  readonly industry_pack_version: number | null;
  readonly industry_pack_runtime_source: string | null;

  readonly patient_full_name: string | null;
  readonly patient_email: string | null;
  readonly patient_phone: string | null;
  readonly patient_status: string | null;

  readonly practice_name: string | null;
  readonly practice_industry: string | null;
  readonly practice_status: string | null;

  readonly provider_subject_id: string | null;

  readonly workflow_instance_id: string | null;
  readonly workflow_state: string | null;
  readonly workflow_current_stage_key: string | null;
  readonly workflow_revision: number | null;
  readonly workflow_blueprint_key: string | null;
  readonly workflow_blueprint_version: number | null;

  readonly care_plan_agreement_id: string | null;
  readonly care_plan_title: string | null;
  readonly care_plan_status: string | null;
  readonly care_plan_starts_on: Date | string | null;
  readonly care_plan_ends_on: Date | string | null;
}

export class DentexTreatmentProjectionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'DentexTreatmentProjectionError';
    this.code = code;
  }
}

function dateOnly(value: Date | string | null): string | null {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function treatmentStage(value: string | null): DentexTreatmentStage | null {
  if (value === null) return null;
  if (value === 'INTAKE' || value === 'IN_PROGRESS' || value === 'REVIEW' || value === 'RESOLVED') {
    return value;
  }
  throw new DentexTreatmentProjectionError(
    'DENTEX_TREATMENT_STAGE_INVALID',
    `Unsupported DENTEX Treatment stage: ${value}`,
  );
}

function urgency(attributes: Record<string, unknown>): DentexTreatmentUrgency {
  const value = attributes.urgency;
  if (
    typeof value === 'string'
    && (DENTEX_TREATMENT_URGENCIES as readonly string[]).includes(value)
  ) {
    return value as DentexTreatmentUrgency;
  }
  throw new DentexTreatmentProjectionError(
    'DENTEX_TREATMENT_URGENCY_INVALID',
    'The Treatment does not contain a valid DENTEX urgency.',
  );
}

function optionalText(attributes: Record<string, unknown>, key: string): string | undefined {
  const value = attributes[key];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/**
 * Hydrates the product-facing DENTEX Treatment workspace from horizontal
 * platform authorities. This is a read model only; no second Treatment store is
 * introduced.
 *
 * Care Plan selection intentionally follows the current semantic-gate rule:
 * the latest ACTIVE crm.agreement for the Treatment's Practice/account.
 */
export async function loadDentexTreatmentWorkspace(
  client: PoolClient,
  input: { readonly tenantId: string; readonly treatmentId: string },
): Promise<DentexTreatmentWorkspace | null> {
  const result = await client.query<TreatmentProjectionRow>(
    `SELECT
       c.case_id,
       c.tenant_id,
       c.account_id,
       c.contact_id,
       c.subject,
       c.description,
       c.priority,
       c.status,
       c.stage_key,
       c.owner_subject_id,
       c.attributes,
       c.attributes_schema_version,
       c.industry_pack_vertical_key,
       c.industry_pack_version,
       c.industry_pack_runtime_source,

       patient.full_name AS patient_full_name,
       patient.email AS patient_email,
       patient.phone AS patient_phone,
       patient.status AS patient_status,

       practice.name AS practice_name,
       practice.industry AS practice_industry,
       practice.status AS practice_status,

       provider.target_entity_id AS provider_subject_id,

       workflow.instance_id AS workflow_instance_id,
       workflow.state AS workflow_state,
       workflow.current_stage_key AS workflow_current_stage_key,
       workflow.revision AS workflow_revision,
       workflow.blueprint_key AS workflow_blueprint_key,
       workflow.blueprint_version AS workflow_blueprint_version,

       care_plan.agreement_id AS care_plan_agreement_id,
       care_plan.title AS care_plan_title,
       care_plan.status AS care_plan_status,
       care_plan.starts_on AS care_plan_starts_on,
       care_plan.ends_on AS care_plan_ends_on

     FROM platform.crm_cases c
     LEFT JOIN platform.crm_contacts patient
       ON patient.tenant_id = c.tenant_id
      AND patient.contact_id = c.contact_id
     LEFT JOIN platform.crm_accounts practice
       ON practice.tenant_id = c.tenant_id
      AND practice.account_id = c.account_id
     LEFT JOIN platform.workflow_instances workflow
       ON workflow.tenant_id = c.tenant_id
      AND workflow.instance_id = c.workflow_instance_id
     LEFT JOIN LATERAL (
       SELECT relationship.target_entity_id
         FROM platform.entity_relationships relationship
        WHERE relationship.tenant_id = c.tenant_id
          AND relationship.source_entity_type = 'crm.case'
          AND relationship.source_entity_id = c.case_id::text
          AND relationship.relationship_key = 'provider'
          AND relationship.status = 'ACTIVE'
          AND relationship.valid_until IS NULL
        ORDER BY relationship.valid_from DESC, relationship.relationship_id DESC
        LIMIT 1
     ) provider ON true
     LEFT JOIN LATERAL (
       SELECT agreement.agreement_id,
              agreement.title,
              agreement.status,
              agreement.starts_on,
              agreement.ends_on
         FROM platform.crm_agreements agreement
        WHERE agreement.tenant_id = c.tenant_id
          AND agreement.account_id = c.account_id
          AND agreement.status = 'ACTIVE'
        ORDER BY agreement.starts_on DESC NULLS LAST,
                 agreement.created_at DESC,
                 agreement.agreement_id DESC
        LIMIT 1
     ) care_plan ON true
    WHERE c.tenant_id = $1::uuid
      AND c.case_id = $2::uuid
    LIMIT 1`,
    [input.tenantId, input.treatmentId],
  );

  const row = result.rows[0];
  if (row === undefined) return null;

  if (row.industry_pack_vertical_key !== 'dentex') {
    throw new DentexTreatmentProjectionError(
      'DENTEX_TREATMENT_PACK_MISMATCH',
      'The requested CRM case is not governed as a DENTEX Treatment.',
    );
  }

  const attributes = row.attributes ?? {};
  const currentStage = treatmentStage(row.workflow_current_stage_key ?? row.stage_key);
  const tooth = optionalText(attributes, 'tooth');
  const procedureCode = optionalText(attributes, 'procedureCode');
  const treatmentAttributes: DentexTreatmentAttributes = {
    urgency: urgency(attributes),
    ...(tooth === undefined ? {} : { tooth }),
    ...(procedureCode === undefined ? {} : { procedureCode }),
  };

  return {
    treatment: {
      treatmentId: row.case_id,
      tenantId: row.tenant_id,
      practiceId: row.account_id,
      patientId: row.contact_id,
      carePlanAgreementId: row.care_plan_agreement_id,
      subject: row.subject,
      description: row.description,
      priority: row.priority,
      status: row.status,
      stage: currentStage,
      schemaVersion: row.attributes_schema_version ?? 0,
      attributes: treatmentAttributes,
    },
    patient: row.contact_id === null || row.patient_full_name === null
      ? null
      : {
          patientId: row.contact_id,
          fullName: row.patient_full_name,
          email: row.patient_email,
          phone: row.patient_phone,
          status: row.patient_status ?? 'ACTIVE',
        },
    practice: row.account_id === null || row.practice_name === null
      ? null
      : {
          practiceId: row.account_id,
          name: row.practice_name,
          industry: row.practice_industry,
          status: row.practice_status ?? 'ACTIVE',
        },
    owner: row.owner_subject_id === null ? null : { subjectId: row.owner_subject_id },
    provider: row.provider_subject_id === null ? null : { subjectId: row.provider_subject_id },
    workflow: row.workflow_instance_id === null
      ? null
      : {
          instanceId: row.workflow_instance_id,
          state: row.workflow_state ?? 'CREATED',
          currentStage,
          revision: row.workflow_revision ?? 0,
          blueprintKey: row.workflow_blueprint_key ?? 'crm.case',
          blueprintVersion: row.workflow_blueprint_version ?? 0,
        },
    carePlan: row.care_plan_agreement_id === null || row.care_plan_title === null
      ? null
      : {
          agreementId: row.care_plan_agreement_id,
          title: row.care_plan_title,
          status: row.care_plan_status ?? 'ACTIVE',
          startsOn: dateOnly(row.care_plan_starts_on),
          endsOn: dateOnly(row.care_plan_ends_on),
        },
    pack: {
      verticalKey: 'dentex',
      version: row.industry_pack_version,
      runtimeSource: row.industry_pack_runtime_source ?? 'CODE_BASELINE',
    },
  };
}
