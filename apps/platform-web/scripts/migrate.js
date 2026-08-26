import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL
});

async function runMigrations() {
  if (!process.env.DATABASE_URL) {
    console.log('Skipping migrations: DATABASE_URL not set.');
    process.exit(0);
  }

  const client = await pool.connect();
  try {
    // Assuming monorepo structure where infra/db/migrations is two levels up from apps/platform-web
    const migrationsDir = path.resolve(__dirname, '../../../infra/db/migrations');
    
    if (!fs.existsSync(migrationsDir)) {
      console.log(`Skipping migrations: Directory not found at ${migrationsDir}`);
      return;
    }

    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
    
    console.log(`Found ${files.length} migrations. Applying...`);
    
    for (const file of files) {
      console.log(`-> Running ${file}`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      await client.query(sql);
    }
    console.log('✅ All migrations applied successfully.');
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations();
