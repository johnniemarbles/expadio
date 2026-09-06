const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error("FATAL ERROR: DATABASE_URL is not set in environment variables!");
  process.exit(1);
}

const fs = require('fs');
const path = require('path');

const dbPool = new Pool({
  connectionString: process.env.DATABASE_URL
});

const DEFAULT_TENANT = process.env.DEMO_TENANT_ID ?? '00000000-0000-0000-0000-000000000001';

const agentsDataPath = path.join(__dirname, 'agents.json');
let curatedPersonas = [];
if (fs.existsSync(agentsDataPath)) {
  curatedPersonas = JSON.parse(fs.readFileSync(agentsDataPath, 'utf8'));
} else {
  console.error("agents.json not found!");
  process.exit(1);
}

async function seedAgents() {
  console.log("Seeding agent catalog and Enterprise default roster...");
  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');

    console.log("Seeding departments...");
    const distinctDepts = [...new Set(curatedPersonas.map(a => a.department))];
    for (const dept of distinctDepts) {
      await client.query(
        `INSERT INTO platform.departments (name, description) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING`,
        [dept, `System generated department for ${dept}`]
      );
    }

    console.log("Inserting curated agent definitions...");
    const insertedAgents = [];
    for (const agent of curatedPersonas) {
      const res = await client.query(
        `INSERT INTO platform.agent_definitions (department, slug, persona, tools, default_on)
         VALUES ($1, $2, $3, $4::jsonb, $5)
         ON CONFLICT (slug) DO UPDATE SET
           department = EXCLUDED.department,
           persona = EXCLUDED.persona,
           tools = EXCLUDED.tools,
           default_on = EXCLUDED.default_on
         RETURNING agent_id`,
        [agent.department, agent.slug, agent.persona, JSON.stringify(agent.tools), agent.default_on]
      );
      insertedAgents.push({ ...agent, agent_id: res.rows[0].agent_id });
    }
    console.log(`Ingested ${insertedAgents.length} agent definitions.`);

    console.log("Seeding Enterprise default roster (binding ALL agents)...");
    await client.query(
      `INSERT INTO platform.tenant_agent_bindings (tenant_id, agent_id, status, bound_by)
       SELECT $1, agent_id, 'ACTIVE', 'system-seed'
       FROM platform.agent_definitions
       ON CONFLICT (tenant_id, agent_id) DO UPDATE SET status = 'ACTIVE'`,
      [DEFAULT_TENANT]
    );

    console.log("Seeding default tool grants for Enterprise...");
    const defaultTools = ['GitHub', 'FS', 'DB', 'Audit', 'Comms'];
    for (const tool of defaultTools) {
      await client.query(
        `INSERT INTO platform.tenant_tool_grants (tenant_id, tool_group, enabled)
         VALUES ($1, $2, true)
         ON CONFLICT (tenant_id, tool_group) DO UPDATE SET enabled = true`,
        [DEFAULT_TENANT, tool]
      );
    }

    await client.query('COMMIT');
    console.log("Agent catalog seeded successfully.");
  } catch (err) {
    await client.query('ROLLBACK');
    console.error("Error seeding agents:", err);
    process.exit(1);
  } finally {
    client.release();
    dbPool.end();
  }
}

seedAgents();
