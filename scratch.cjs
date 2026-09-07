const { Pool } = require('pg');
require('dotenv').config({ path: 'apps/platform-web/.env.local' });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.query('SELECT COUNT(*) FROM platform.agent_definitions').then(res => console.log('Definitions:', res.rows[0].count)).catch(e => console.error(e.message)).finally(() => pool.end());
