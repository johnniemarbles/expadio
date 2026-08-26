import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (!process.env.DATABASE_URL) { console.error("FATAL ERROR: DATABASE_URL is not set in environment variables! Railway cannot connect to PostgreSQL."); process.exit(1); }
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
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.schema_migrations (
        version text PRIMARY KEY,
        applied_at timestamptz DEFAULT now()
      )
    `);

    // Backfill schema_migrations for the existing database
    const { rowCount: smCount } = await client.query('SELECT 1 FROM public.schema_migrations LIMIT 1');
    if (smCount === 0) {
      const { rowCount: capCount } = await client.query(`
        SELECT 1 FROM information_schema.tables WHERE table_schema = 'platform' AND table_name = 'capability_state'
      `);
      if (capCount && capCount > 0) {
        console.log("Database was already migrated. Backfilling schema_migrations...");
        const migrationsDir = path.resolve(__dirname, '../../../infra/db/migrations');
        const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
        for (const file of files) {
          await client.query('INSERT INTO public.schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING', [file]);
        }
      }
    }

    // Assuming monorepo structure where infra/db/migrations is two levels up from apps/platform-web
    const migrationsDir = path.resolve(__dirname, '../../../infra/db/migrations');
    
    if (!fs.existsSync(migrationsDir)) {
      console.log(`Skipping migrations: Directory not found at ${migrationsDir}`);
      return;
    }

    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
    
    console.log(`Found ${files.length} migrations. Applying...`);
    
    for (const file of files) {
      const { rowCount } = await client.query('SELECT 1 FROM public.schema_migrations WHERE version = $1', [file]);
      if (rowCount && rowCount > 0) {
        continue; // Skip already applied
      }

      console.log(`-> Running ${file}`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO public.schema_migrations (version) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
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
