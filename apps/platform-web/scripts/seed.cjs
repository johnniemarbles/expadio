const { Pool } = require('pg');

if (!process.env.DATABASE_URL) { console.error("FATAL ERROR: DATABASE_URL is not set in environment variables! Railway cannot connect to PostgreSQL."); process.exit(1); }
const dbPool = new Pool({
  connectionString: process.env.DATABASE_URL
});

const DEFAULT_TENANT = '00000000-0000-0000-0000-000000000001';
const DEFAULT_ORG = '00000000-0000-0000-0000-000000000002';
const SUBJECT_ID = process.env.CLERK_ADMIN_USER_ID || process.argv[2];

if (!SUBJECT_ID) {
  console.log("No CLERK_ADMIN_USER_ID provided. Skipping membership database seeding.");
  process.exit(0);
}

async function seed() {
  console.log("Seeding database for subject:", SUBJECT_ID);
  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');

    // 1. Ensure Tenant exists
    const resTenant = await client.query('SELECT tenant_id FROM platform.tenants WHERE tenant_id = $1', [DEFAULT_TENANT]);
    if (resTenant.rowCount === 0) {
      await client.query(
        "INSERT INTO platform.tenants (tenant_id, name, status) VALUES ($1, 'Dreamware Inc', 'ACTIVE')",
        [DEFAULT_TENANT]
      );
      console.log(`Created tenant: ${DEFAULT_TENANT}`);
    }

    // 2. Ensure Org exists
    const resOrg = await client.query('SELECT organization_id FROM platform.organizations WHERE organization_id = $1', [DEFAULT_ORG]);
    if (resOrg.rowCount === 0) {
      await client.query(
        "INSERT INTO platform.organizations (organization_id, tenant_id, organization_kind, name, status) VALUES ($1, $2, 'BUSINESS', 'Dreamware Platform', 'ACTIVE')",
        [DEFAULT_ORG, DEFAULT_TENANT]
      );
      console.log(`Created organization: ${DEFAULT_ORG}`);
    }

    // 3. Insert subject membership
    const resMember = await client.query('SELECT membership_id FROM platform.memberships WHERE subject_id = $1 AND tenant_id = $2', [SUBJECT_ID, DEFAULT_TENANT]);
    if (resMember.rowCount === 0) {
      await client.query(
        `INSERT INTO platform.memberships (tenant_id, organization_id, subject_id, actor_kind, status, issuer, workspace_scope_mode, operating_unit_scope_mode)
         VALUES ($1, $2, $3, 'user', 'ACTIVE', 'https://clerk.expadio.com', 'ALL', 'ALL')`,
        [DEFAULT_TENANT, DEFAULT_ORG, SUBJECT_ID]
      );
      console.log(`Granted membership to subject: ${SUBJECT_ID}`);
    } else {
      await client.query("UPDATE platform.memberships SET issuer = 'https://clerk.expadio.com' WHERE subject_id = $1", [SUBJECT_ID]);
      console.log(`Subject ${SUBJECT_ID} already has membership. Updated issuer.`);
    }
    // 4. Seed capabilities
    const capRes = await client.query('SELECT capability_id FROM platform.capabilities LIMIT 1');
    if (capRes.rowCount === 0) {
      // Create base capabilities
      const caps = [
        { key: 'knowledge_curator', name: 'Knowledge Curator', modes: ['A'] },
        { key: 'correction_review', name: 'Correction Review', modes: ['A', 'B'] },
        { key: 'policy_explainer', name: 'Policy Explainer', modes: ['A'] },
        { key: 'incident_response', name: 'Incident Response', modes: ['A', 'B', 'C'] },
        { key: 'compliance_audit', name: 'Compliance Auditing', modes: ['A'] },
      ];
      for (const cap of caps) {
        await client.query(
          `INSERT INTO platform.capabilities (capability_key, display_name, permitted_modes)
           VALUES ($1, $2, $3) ON CONFLICT (capability_key) DO NOTHING`,
          [cap.key, cap.name, cap.modes]
        );
      }
      console.log(`Seeded ${caps.length} capabilities.`);
    }

    // 5. Seed capability bindings + state
    const bindRes = await client.query('SELECT binding_id FROM platform.tenant_capability_bindings WHERE tenant_id = $1 LIMIT 1', [DEFAULT_TENANT]);
    if (bindRes.rowCount === 0) {
      const capIds = await client.query('SELECT capability_id FROM platform.capabilities ORDER BY created_at');
      for (const row of capIds.rows) {
        const bindingId = require('crypto').randomUUID();
        await client.query(
          `INSERT INTO platform.tenant_capability_bindings (binding_id, tenant_id, organization_id, capability_id, mode, is_entitled, is_within_bounds)
           VALUES ($1, $2, $3, $4, 'A', true, true)`,
          [bindingId, DEFAULT_TENANT, DEFAULT_ORG, row.capability_id]
        );
        const inputHash = require('crypto').createHash('sha256').update(bindingId).digest('hex');
        await client.query(
          `INSERT INTO platform.capability_state (binding_id, tenant_id, state, reason_key, input_hash, version, resolved_at)
           VALUES ($1, $2, 'ACTIVE', 'SEED', $3, 1, NOW())`,
          [bindingId, DEFAULT_TENANT, inputHash]
        );
      }
      console.log('Seeded capability bindings and state.');
    }

    // 6. Seed knowledge documents
    const kdRes = await client.query('SELECT document_reference FROM platform.knowledge_documents WHERE tenant_id = $1 LIMIT 1', [DEFAULT_TENANT]);
    if (kdRes.rowCount === 0) {
      const docs = [
        { collection: 'corporate-policy', doc: 'expense-approval', source: 'gs://policy-bucket/expense-v3.pdf', version: 1, reason: 'Initial policy index' },
        { collection: 'corporate-policy', doc: 'travel-guidelines', source: 'gs://policy-bucket/travel-v2.pdf', version: 1, reason: 'Initial policy index' },
        { collection: 'safety-codes', doc: 'workplace-safety', source: 'gs://safety-bucket/workplace.pdf', version: 1, reason: 'Compliance requirement' },
        { collection: 'hr-handbook', doc: 'onboarding-checklist', source: 'gs://hr-bucket/onboarding.pdf', version: 1, reason: 'HR documentation' },
      ];
      for (const doc of docs) {
        const digest = require('crypto').createHash('sha256').update(doc.doc + doc.version).digest('hex');
        const corrId = require('crypto').randomUUID();
        await client.query(
          `INSERT INTO platform.knowledge_documents 
           (tenant_id, collection_reference, document_reference, document_version, source_reference, source_digest, 
            metadata_reference, embedding_configuration_key, embedding_configuration_version, 
            access_policy_key, access_policy_version, retention_policy_key, retention_policy_version,
            authorization_decision_id, indexed_at, indexed_by_subject_id, reason, correlation_id, evidence_refs,
            index_reference, ingestion_id, purpose, requested_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), $15, $16, $17, $18, $19, $20, $21, NOW())
           ON CONFLICT DO NOTHING`,
          [
            DEFAULT_TENANT, doc.collection, doc.doc, doc.version, doc.source, digest,
            'meta:' + doc.doc, 'text-embedding-3-small', 1,
            'default-read', 1, 'standard-90d', 1,
            'seed-decision-' + doc.doc, SUBJECT_ID || 'seed-system', doc.reason, corrId,
            ['seed:initial-index'], doc.source, 'seed-ingestion-' + doc.doc, doc.reason
          ]
        );
      }
      console.log(`Seeded ${docs.length} knowledge documents.`);
    }

    // 7. Seed correction proposals
    const cpRes = await client.query('SELECT proposal_reference FROM platform.company_brain_correction_proposals WHERE tenant_id = $1 LIMIT 1', [DEFAULT_TENANT]);
    if (cpRes.rowCount === 0) {
      const proposals = [
        {
          ref: 'corr-seed-001', execution: 'exec-001', proposer: SUBJECT_ID || 'seed-system',
          agent: 'knowledge-curator', category: 'OUTDATED_FACT', targetKind: 'COMPANY_FACT',
          target: 'expense-approval-v2', origRef: 'obj://orig/expense-old', origDigest: require('crypto').createHash('sha256').update('old-expense').digest('hex'),
          propRef: 'obj://proposed/expense-new', propDigest: require('crypto').createHash('sha256').update('new-expense').digest('hex'),
          reasonKey: 'POLICY_UPDATE_Q3'
        },
        {
          ref: 'corr-seed-002', execution: 'exec-002', proposer: SUBJECT_ID || 'seed-system',
          agent: 'compliance-auditor', category: 'POLICY_VIOLATION', targetKind: 'POLICY',
          target: 'travel-guidelines-v1', origRef: 'obj://orig/travel-old', origDigest: require('crypto').createHash('sha256').update('old-travel').digest('hex'),
          propRef: 'obj://proposed/travel-new', propDigest: require('crypto').createHash('sha256').update('new-travel').digest('hex'),
          reasonKey: 'COMPLIANCE_GAP_DETECTED'
        }
      ];
      for (const p of proposals) {
        const corrId = require('crypto').randomUUID();
        await client.query(
          `INSERT INTO platform.company_brain_correction_proposals
           (proposal_reference, tenant_id, execution_id, proposer_subject_id, agent_id, category, target_kind, target_reference,
            original_output_reference, original_output_digest, proposed_correction_reference, proposed_correction_digest,
            reason_key, created_at, correlation_id, evidence_refs)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), $14, $15)
           ON CONFLICT DO NOTHING`,
          [
            p.ref, DEFAULT_TENANT, p.execution, p.proposer, p.agent, p.category, p.targetKind, p.target,
            p.origRef, 'sha256:' + p.origDigest, p.propRef, 'sha256:' + p.propDigest,
            p.reasonKey, corrId, ['seed:initial-correction']
          ]
        );
      }
      console.log(`Seeded ${proposals.length} correction proposals.`);
    }

    
    // 8. Seed communication templates
    const ctRes = await client.query("SELECT template_id FROM platform.communication_templates WHERE trigger_key = 'identity.verification.code' LIMIT 1");
    if (ctRes.rowCount === 0) {
      await client.query(`
        INSERT INTO platform.communication_templates 
        (scope, tenant_id, organization_id, trigger_key, channel, locale, content_format, subject, title, body, required_variables, default_variables, status) 
        VALUES 
        ('PLATFORM', NULL, NULL, 'identity.verification.code', 'email', 'en', 'HTML', 'Your Verification Code', 'Sign in to Expadio', 
        '<p>Hello!</p><p>Your verification code is <strong>{{code}}</strong>.</p><p>It will expire in 10 minutes.</p>', 
        '["code"]', '{"code": "123456"}', 'ACTIVE')
      `);
      console.log('Seeded platform communication templates.');
    }

    await client.query("COMMIT");
    console.log("Database seeded successfully.");

  } catch (err) {
    await client.query('ROLLBACK');
    console.error("Error seeding database:", err);
    process.exit(1);
  } finally {
    client.release();
    await dbPool.end();
  }
}

seed();
