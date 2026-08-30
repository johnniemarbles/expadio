import { NextResponse } from 'next/server';
import { dbPool } from '../../../lib/iam-adapter';
import { deniedResponse, resolveRequestContext } from '../../../lib/request-context';
import crypto from 'node:crypto';

export async function GET(request: Request) {
  try {
    const effectiveContext = await resolveRequestContext(request);
    
    const result = await dbPool.query(
      `SELECT DISTINCT ON (setting_key) setting_key, level, value
       FROM platform.configuration_setting_values 
       WHERE (tenant_id = $1 OR tenant_id IS NULL)
       AND (effective_until IS NULL OR effective_until > NOW())
       ORDER BY setting_key, (level = 'TENANT') DESC, effective_from DESC
       LIMIT 50`,
      [effectiveContext.tenantId]
    );

    const activeSettings = result.rows.map((row: any) => ({
      key: row.setting_key,
      value: typeof row.value === 'object' ? JSON.stringify(row.value) : String(row.value),
      scope: row.level,
      overridden: row.level === 'TENANT'
    }));

    const dynamicConfig = {
      scopes: ['PLATFORM', 'TENANT', 'WORKSPACE'],
      activeSettings
    };
    return NextResponse.json(dynamicConfig);
  } catch (error: any) {
    const denied = deniedResponse(error);
    return NextResponse.json(denied.body, { status: denied.status });
  }
}

export async function POST(request: Request) {
  try {
    const effectiveContext = await resolveRequestContext(request);

    const body = await request.json();
    const { key, value } = body;
    
    if (!key || value === undefined) {
      return NextResponse.json({ error: 'Missing key or value' }, { status: 400 });
    }

    const valueId = crypto.randomUUID();
    const correlationId = crypto.randomUUID();
    let parsedValue;
    try {
      parsedValue = JSON.parse(value);
    } catch {
      parsedValue = value;
    }

    const client = await dbPool.connect();
    try {
      await client.query('BEGIN');
      
      const defRes = await client.query('SELECT version FROM platform.configuration_setting_definitions WHERE setting_key = $1 ORDER BY version DESC LIMIT 1', [key]);
      const definitionVersion = defRes.rows.length > 0 ? defRes.rows[0].version : 1;
      
      const recRes = await client.query('SELECT record_version FROM platform.configuration_setting_values WHERE setting_key = $1 AND level = $2 AND scope_id = $3 ORDER BY record_version DESC LIMIT 1', [key, 'TENANT', effectiveContext.tenantId]);
      const recordVersion = recRes.rows.length > 0 ? recRes.rows[0].record_version + 1 : 1;

      await client.query(
        `INSERT INTO platform.configuration_setting_values 
         (value_id, setting_key, definition_version, level, scope_id, tenant_id, record_version, value, effective_from, authored_by_subject_id, authored_at, reason, correlation_id, evidence_refs)
         VALUES ($1, $2, $3, 'TENANT', $4, $4, $5, $6, NOW(), $7, NOW(), 'UI Override', $8, ARRAY['ui-mutation'])`,
        [valueId, key, definitionVersion, effectiveContext.tenantId, recordVersion, JSON.stringify(parsedValue), effectiveContext.subjectId, correlationId]
      );
      
      await client.query('COMMIT');
      return NextResponse.json({ success: true, key, value: parsedValue });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error("Config POST API Error:", error);
    const denied = deniedResponse(error);
    return NextResponse.json(denied.body, { status: denied.status });
  }
}

