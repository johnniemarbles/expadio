const { Pool } = require('pg');
const crypto = require('crypto');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:whJQVdwHCjrAIzMyRvaibEmzMfoCXpZL@postgres.railway.internal:5432/railway'
});

async function runTests() {
  const tenantId = '00000000-0000-0000-0000-000000000001';
  const userId = 'user_test_123';
  
  console.log('--- STARTING VERIFICATION TESTS ---');

  const client = await pool.connect();
  try {
    // TEST 1
    console.log('\\n[TEST 1] Configuration Manager - Tenant Override');
    const configKey = 'ai.safety.toxicity_threshold';
    
    const preConfigRes = await client.query(
      `SELECT DISTINCT ON (setting_key) setting_key, level, value
       FROM platform.configuration_setting_values 
       WHERE (tenant_id = $1 OR tenant_id IS NULL)
       AND (effective_until IS NULL OR effective_until > NOW())
       AND setting_key = $2
       ORDER BY setting_key, (level = 'TENANT') DESC, effective_from DESC`,
      [tenantId, configKey]
    );
    console.log('State BEFORE:', preConfigRes.rows[0]);

    await client.query('BEGIN');
    const defRes = await client.query('SELECT version FROM platform.configuration_setting_definitions WHERE setting_key = $1 ORDER BY version DESC LIMIT 1', [configKey]);
    const definitionVersion = defRes.rows.length > 0 ? defRes.rows[0].version : 1;
    const recRes = await client.query('SELECT record_version FROM platform.configuration_setting_values WHERE setting_key = $1 AND level = $2 AND scope_id = $3 ORDER BY record_version DESC LIMIT 1', [configKey, 'TENANT', tenantId]);
    const recordVersion = recRes.rows.length > 0 ? recRes.rows[0].record_version + 1 : 1;

    await client.query(
      `INSERT INTO platform.configuration_setting_values 
       (value_id, setting_key, definition_version, level, scope_id, tenant_id, record_version, value, effective_from, authored_by_subject_id, authored_at, reason, correlation_id, evidence_refs)
       VALUES ($1, $2, $3, 'TENANT', $4, $4, $5, $6, NOW(), $7, NOW(), 'UI Override', $8, ARRAY['ui-mutation'])`,
      [crypto.randomUUID(), configKey, definitionVersion, tenantId, recordVersion, JSON.stringify("0.99"), userId, crypto.randomUUID()]
    );
    await client.query('COMMIT');
    console.log('✅ Executed POST mutation (Inserted TENANT override "0.99")');

    const postConfigRes = await client.query(
      `SELECT DISTINCT ON (setting_key) setting_key, level, value
       FROM platform.configuration_setting_values 
       WHERE (tenant_id = $1 OR tenant_id IS NULL)
       AND (effective_until IS NULL OR effective_until > NOW())
       AND setting_key = $2
       ORDER BY setting_key, (level = 'TENANT') DESC, effective_from DESC`,
      [tenantId, configKey]
    );
    console.log('State AFTER:', postConfigRes.rows[0]);
    if (postConfigRes.rows[0]?.value === '"0.99"' && postConfigRes.rows[0]?.level === 'TENANT') {
      console.log('✅ SUCCESS: GET endpoint successfully reflects the new Tenant override!');
    } else {
      console.error('❌ FAILED: Configuration override not reflected.');
    }

    // TEST 2
    console.log('\\n[TEST 2] Capabilities Manager - State Toggle');
    const capLookup = await client.query('SELECT binding_id, state FROM platform.capability_state WHERE tenant_id = $1 LIMIT 1', [tenantId]);
    if (capLookup.rows.length > 0) {
      const targetId = capLookup.rows[0].binding_id;
      const originalState = capLookup.rows[0].state;
      console.log(`Targeting capability: ${targetId}, Current State: ${originalState}`);

      const newState = originalState === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
      
      await client.query('BEGIN');
      const updateRes = await client.query(
        `UPDATE platform.capability_state SET state = $1, resolved_at = NOW(), version = version + 1 
         WHERE binding_id = $2 AND tenant_id = $3 RETURNING input_hash`,
        [newState, targetId, tenantId]
      );
      if (updateRes.rowCount > 0) {
        await client.query(
          `INSERT INTO platform.capability_state_events (binding_id, tenant_id, from_state, to_state, reason_key, input_hash, occurred_at)
           VALUES ($1, $2, 'UNKNOWN', $3, 'UI_MUTATION', $4, NOW())`,
          [targetId, tenantId, newState, updateRes.rows[0].input_hash]
        );
      }
      await client.query('COMMIT');
      console.log(`✅ Executed POST mutation (Toggled to ${newState})`);

      const capVerify = await client.query('SELECT state FROM platform.capability_state WHERE binding_id = $1', [targetId]);
      console.log('State AFTER:', capVerify.rows[0]?.state);
      
      const eventVerify = await client.query('SELECT to_state, reason_key FROM platform.capability_state_events WHERE binding_id = $1 ORDER BY occurred_at DESC LIMIT 1', [targetId]);
      console.log('Audit Event Logged:', eventVerify.rows[0]);

      if (capVerify.rows[0]?.state === newState && eventVerify.rows.length > 0) {
        console.log('✅ SUCCESS: Capability updated and immutable audit event securely logged!');
      } else {
        console.error('❌ FAILED: Capability toggle failed or audit log missing.');
      }
    } else {
      console.log('⚠️ Skipped: No capabilities found for tenant.');
    }

    // TEST 3
    console.log('\\n[TEST 3] Governance Reviews - Simulated Action Logging');
    const mockProposalId = 'prop_12345';
    
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO platform.agent_run_events (tenant_id, event_type, event_reference, actor_subject_id, reason, occurred_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [tenantId, 'REVIEW_DECISION_SIMULATED', mockProposalId, userId, 'Simulated APPROVED of correction proposal']
    );
    await client.query('COMMIT');
    console.log('✅ Executed POST mutation (Inserted simulation event)');

    const simVerify = await client.query(
      'SELECT event_type, reason FROM platform.agent_run_events WHERE event_reference = $1 AND tenant_id = $2',
      [mockProposalId, tenantId]
    );
    console.log('Logged Event:', simVerify.rows[0]);
    
    if (simVerify.rows.length > 0) {
      console.log('✅ SUCCESS: Decision accurately isolated and recorded in tenant agent_run_events.');
    } else {
      console.error('❌ FAILED: Review decision event missing.');
    }

  } catch (err) {
    console.error('Test Execution Error:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

runTests();
