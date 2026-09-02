import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import {
  approveAndActivateEnterpriseCommercialAgreement,
  approveEnterpriseAppointment,
  createEnterpriseAppointment,
  createEnterpriseCommercialAgreement,
  issueEnterpriseAppointmentRights,
  moveEnterpriseAppointmentToReview,
  startEnterpriseJurisdictionActivation,
  verifyAndActivateEnterpriseJurisdiction,
} from '../lib/enterprise-commercial';

function pool(): pg.Pool {
  return new pg.Pool({
    host: process.env.PGHOST ?? 'localhost',
    port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER ?? 'postgres',
    password: process.env.PGPASSWORD ?? 'postgres',
    database: process.env.PGDATABASE ?? 'expadio_test',
    max: 1,
  });
}

test('commercial appointment -> rights -> verified jurisdiction activation is governed end to end', async () => {
  const p = pool();
  const c = await p.connect();
  try {
    const tenantId = randomUUID();
    const rootOrganizationId = randomUUID();
    const beneficiaryOrganizationId = randomUUID();

    await c.query(
      `INSERT INTO platform.tenants (tenant_id, name, status)
       VALUES ($1::uuid, 'Enterprise commercial integration', 'ACTIVE')`,
      [tenantId],
    );
    await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);

    await c.query(
      `INSERT INTO platform.organizations (
         organization_id, tenant_id, organization_kind, name, status
       ) VALUES ($1::uuid, $2::uuid, 'GLOBAL_HQ', 'Global HQ', 'ACTIVE')`,
      [rootOrganizationId, tenantId],
    );

    const enterpriseId = (
      await c.query<{ enterprise_id: string }>(
        `SELECT enterprise_id
           FROM platform.organizations
          WHERE tenant_id = $1::uuid
            AND organization_id = $2::uuid`,
        [tenantId, rootOrganizationId],
      )
    ).rows[0]?.enterprise_id;
    assert.ok(enterpriseId);

    await c.query(
      `INSERT INTO platform.organizations (
         organization_id, tenant_id, enterprise_id, parent_organization_id,
         organization_kind, name, status
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid, $4::uuid,
         'COUNTRY', 'Canada', 'ACTIVE'
       )`,
      [beneficiaryOrganizationId, tenantId, enterpriseId, rootOrganizationId],
    );

    const grantorLegalEntityId = randomUUID();
    const granteeLegalEntityId = randomUUID();
    await c.query(
      `INSERT INTO platform.legal_entities (
         legal_entity_id, tenant_id, enterprise_id, legal_name, entity_type,
         jurisdiction_country_code, status, verified_at, created_by_subject_id
       ) VALUES
       ($1::uuid, $3::uuid, $4::uuid, 'Global Licensor Inc', 'CORPORATION',
        'US', 'VERIFIED', now(), 'seed'),
       ($2::uuid, $3::uuid, $4::uuid, 'Canada Operator Inc', 'CORPORATION',
        'CA', 'VERIFIED', now(), 'seed')`,
      [grantorLegalEntityId, granteeLegalEntityId, tenantId, enterpriseId],
    );

    await c.query(
      `INSERT INTO platform.organization_legal_entity_bindings (
         organization_legal_entity_binding_id, tenant_id, organization_id,
         legal_entity_id, binding_role, status, created_by_subject_id
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid, $4::uuid,
         'OPERATED_BY', 'ACTIVE', 'seed'
       )`,
      [
        randomUUID(),
        tenantId,
        beneficiaryOrganizationId,
        granteeLegalEntityId,
      ],
    );

    const adminRoleId = (
      await c.query<{ role_id: string }>(
        `INSERT INTO platform.authorization_roles (
           role_key, display_name, ownership_scope, tenant_id, status
         ) VALUES (
           'TENANT_ADMIN', 'Commercial approver', 'TENANT', $1::uuid, 'ACTIVE'
         )
         RETURNING role_id`,
        [tenantId],
      )
    ).rows[0]!.role_id;
    await c.query(
      `INSERT INTO platform.authorization_assignments (
         tenant_id, organization_id, subject_id, role_id, status
       ) VALUES ($1::uuid, $2::uuid, 'commercial-approver', $3::uuid, 'ACTIVE')`,
      [tenantId, rootOrganizationId, adminRoleId],
    );

    const territoryId = randomUUID();
    await c.query(
      `INSERT INTO platform.enterprise_territories (
         territory_id, tenant_id, enterprise_id, territory_key, name,
         territory_kind, country_code, created_by_subject_id
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid, 'ca', 'Canada',
         'COUNTRY', 'CA', 'commercial-maker'
       )`,
      [territoryId, tenantId, enterpriseId],
    );

    const agreement = await createEnterpriseCommercialAgreement(c, {
      tenantId,
      enterpriseId,
      title: 'Canada Master Distribution Agreement',
      agreementKind: 'DISTRIBUTION',
      agreementNumber: 'DIST-CA-001',
      grantorLegalEntityId,
      granteeLegalEntityId,
      sponsoringOrganizationId: rootOrganizationId,
      governingLawCountryCode: 'CA',
      createdBySubjectId: 'commercial-maker',
      idempotencyKey: 'agreement-dist-ca-001',
    });
    const agreementReplay = await createEnterpriseCommercialAgreement(c, {
      tenantId,
      enterpriseId,
      title: 'Canada Master Distribution Agreement',
      agreementKind: 'DISTRIBUTION',
      agreementNumber: 'DIST-CA-001',
      grantorLegalEntityId,
      granteeLegalEntityId,
      sponsoringOrganizationId: rootOrganizationId,
      governingLawCountryCode: 'CA',
      createdBySubjectId: 'commercial-maker',
      idempotencyKey: 'agreement-dist-ca-001',
    });
    assert.equal(agreementReplay.agreementId, agreement.agreementId);
    await assert.rejects(
      () => createEnterpriseCommercialAgreement(c, {
        tenantId,
        enterpriseId,
        title: 'Different agreement payload',
        agreementKind: 'DISTRIBUTION',
        agreementNumber: 'DIST-CA-001',
        grantorLegalEntityId,
        granteeLegalEntityId,
        sponsoringOrganizationId: rootOrganizationId,
        governingLawCountryCode: 'CA',
        createdBySubjectId: 'commercial-maker',
        idempotencyKey: 'agreement-dist-ca-001',
      }),
      /ENTERPRISE_IDEMPOTENCY_KEY_CONFLICT/,
    );
    await approveAndActivateEnterpriseCommercialAgreement(c, {
      tenantId,
      agreementId: agreement.agreementId,
      approvedBySubjectId: 'commercial-approver',
      executionEvidenceRefs: ['document:agreement:executed:dist-ca-001'],
    });

    const appointment = await createEnterpriseAppointment(c, {
      tenantId,
      enterpriseId,
      agreementId: agreement.agreementId,
      grantorOrganizationId: rootOrganizationId,
      beneficiaryOrganizationId,
      beneficiaryLegalEntityId: granteeLegalEntityId,
      appointmentKind: 'DISTRIBUTOR',
      rightsProfileKey: 'enterprise.channel-partner',
      requestedRightTypes: ['SELL', 'DISTRIBUTE'],
      territoryIds: [territoryId],
      requestedBySubjectId: 'commercial-maker',
      idempotencyKey: 'appointment-dist-ca-001',
    });
    const appointmentReplay = await createEnterpriseAppointment(c, {
      tenantId,
      enterpriseId,
      agreementId: agreement.agreementId,
      grantorOrganizationId: rootOrganizationId,
      beneficiaryOrganizationId,
      beneficiaryLegalEntityId: granteeLegalEntityId,
      appointmentKind: 'DISTRIBUTOR',
      rightsProfileKey: 'enterprise.channel-partner',
      requestedRightTypes: ['DISTRIBUTE', 'SELL'],
      territoryIds: [territoryId],
      requestedBySubjectId: 'commercial-maker',
      idempotencyKey: 'appointment-dist-ca-001',
    });
    assert.equal(appointmentReplay.appointmentId, appointment.appointmentId);
    assert.equal(appointmentReplay.workflowInstanceId, appointment.workflowInstanceId);
    await assert.rejects(
      () => createEnterpriseAppointment(c, {
        tenantId,
        enterpriseId,
        agreementId: agreement.agreementId,
        grantorOrganizationId: rootOrganizationId,
        beneficiaryOrganizationId,
        beneficiaryLegalEntityId: granteeLegalEntityId,
        appointmentKind: 'BROKER',
        rightsProfileKey: 'enterprise.channel-partner',
        requestedRightTypes: ['SELL', 'DISTRIBUTE'],
        territoryIds: [territoryId],
        requestedBySubjectId: 'commercial-maker',
        idempotencyKey: 'appointment-dist-ca-001',
      }),
      /ENTERPRISE_IDEMPOTENCY_KEY_CONFLICT/,
    );

    await moveEnterpriseAppointmentToReview(c, {
      tenantId,
      appointmentId: appointment.appointmentId,
      actorSubjectId: 'commercial-maker',
    });
    await approveEnterpriseAppointment(c, {
      tenantId,
      appointmentId: appointment.appointmentId,
      approverSubjectId: 'commercial-approver',
    });

    await assert.rejects(
      () => c.query(
        `UPDATE platform.enterprise_appointments
            SET state = 'ACTIVE',
                activated_at = now()
          WHERE tenant_id = $1::uuid
            AND enterprise_appointment_id = $2::uuid`,
        [tenantId, appointment.appointmentId],
      ),
      /appointment activation requires workflow rights grant/,
    );

    const rights = await issueEnterpriseAppointmentRights(c, {
      tenantId,
      appointmentId: appointment.appointmentId,
      actorSubjectId: 'commercial-approver',
      evidenceRefs: ['decision:commercial-review:approved'],
    });

    const grant = await c.query<{
      state: string;
      source_agreement_id: string;
      beneficiary_organization_id: string;
      scope: { territoryIds?: string[] };
    }>(
      `SELECT state, source_agreement_id, beneficiary_organization_id, scope
         FROM platform.workflow_rights_grants
        WHERE tenant_id = $1::uuid
          AND grant_id = $2::uuid`,
      [tenantId, rights.grantId],
    );
    assert.equal(grant.rows[0]?.state, 'ACTIVE');
    assert.equal(grant.rows[0]?.source_agreement_id, agreement.agreementId);
    assert.equal(grant.rows[0]?.beneficiary_organization_id, beneficiaryOrganizationId);
    assert.deepEqual(grant.rows[0]?.scope.territoryIds, [territoryId]);

    const jurisdiction = await startEnterpriseJurisdictionActivation(c, {
      tenantId,
      enterpriseId,
      appointmentId: appointment.appointmentId,
      territoryId,
      requestedBySubjectId: 'commercial-approver',
      evidenceRefs: ['request:jurisdiction:canada'],
      idempotencyKey: 'jurisdiction-dist-ca-001',
    });
    const jurisdictionReplay = await startEnterpriseJurisdictionActivation(c, {
      tenantId,
      enterpriseId,
      appointmentId: appointment.appointmentId,
      territoryId,
      requestedBySubjectId: 'commercial-approver',
      evidenceRefs: ['request:jurisdiction:canada'],
      idempotencyKey: 'jurisdiction-dist-ca-001',
    });
    assert.equal(jurisdictionReplay.jurisdictionActivationId, jurisdiction.jurisdictionActivationId);
    assert.equal(jurisdictionReplay.workflowActivationId, jurisdiction.workflowActivationId);

    await assert.rejects(
      () => c.query(
        `UPDATE platform.enterprise_jurisdiction_activations
            SET state = 'ACTIVE',
                approved_by_subject_id = 'commercial-approver',
                approved_at = now(),
                activated_by_subject_id = 'commercial-approver',
                activated_at = now(),
                evidence_refs = ARRAY['premature']
          WHERE tenant_id = $1::uuid
            AND enterprise_jurisdiction_activation_id = $2::uuid`,
        [tenantId, jurisdiction.jurisdictionActivationId],
      ),
      /jurisdiction activation requires verified activation evidence/,
    );

    const evidence = 'dossier:jurisdiction:canada:ready';
    const dimensions = [
      'AGREEMENT',
      'RIGHTS',
      'ACCESS',
      'COMPLIANCE',
      'OPERATIONAL_READINESS',
    ] as const;
    await verifyAndActivateEnterpriseJurisdiction(c, {
      tenantId,
      jurisdictionActivationId: jurisdiction.jurisdictionActivationId,
      verifiedBySubjectId: 'commercial-approver',
      reason: 'All jurisdiction activation controls satisfied.',
      assessments: dimensions.map((dimension) => ({
        dimension,
        outcome: 'SATISFIED' as const,
        reason: `${dimension} verified against the activation dossier.`,
        evidenceRefs: [evidence],
      })),
      evidenceRefs: [evidence],
    });

    const active = await c.query<{
      state: string;
      workflow_activation_id: string;
      activated_by_subject_id: string;
    }>(
      `SELECT state, workflow_activation_id, activated_by_subject_id
         FROM platform.enterprise_jurisdiction_activations
        WHERE tenant_id = $1::uuid
          AND enterprise_jurisdiction_activation_id = $2::uuid`,
      [tenantId, jurisdiction.jurisdictionActivationId],
    );
    assert.equal(active.rows[0]?.state, 'ACTIVE');
    assert.equal(active.rows[0]?.workflow_activation_id, jurisdiction.workflowActivationId);
    assert.equal(active.rows[0]?.activated_by_subject_id, 'commercial-approver');

    const verification = await c.query<{ state: string }>(
      `SELECT state
         FROM platform.workflow_activation_verifications
        WHERE tenant_id = $1::uuid
          AND activation_id = $2::uuid`,
      [tenantId, jurisdiction.workflowActivationId],
    );
    assert.deepEqual(verification.rows.map((row) => row.state), ['VERIFIED']);
  } finally {
    c.release();
    await p.end();
  }
});
