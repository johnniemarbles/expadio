import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.DATABASE_PRIVATE_URL;

if (!dbUrl) {
  console.log('Skipping migrations: DATABASE_URL not set in environment.');
  process.exit(0);
}

const pool = new pg.Pool({ connectionString: dbUrl });

async function runMigrations() {
  const client = await pool.connect().catch((err) => {
    console.warn('Warning: Could not connect to PostgreSQL database during startup:', err.message);
    return null;
  });

  if (!client) {
    console.warn('Skipping migrations due to database connection error.');
    return;
  }
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.schema_migrations (
        version text PRIMARY KEY,
        applied_at timestamptz DEFAULT now()
      )
    `);

    // Legacy reconciliation must never infer "all migrations applied" from an
    // early schema object. Only a latest-generation sentinel proves that the
    // existing database already contains the current migration generation.
    const { rowCount: smCount } = await client.query('SELECT 1 FROM public.schema_migrations LIMIT 1');
    if (smCount === 0) {
      const { rows: sentinelRows } = await client.query(`
        SELECT
          to_regclass('platform.capability_state') AS early_sentinel,
          to_regclass('platform.execution_artifacts') AS latest_sentinel
      `);
      const sentinel = sentinelRows[0] ?? {};
      if (sentinel.latest_sentinel) {
        console.log("Database has the latest schema sentinel. Backfilling schema_migrations...");
        const migrationsDir = path.resolve(__dirname, '../../../infra/db/migrations');
        const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
        const reconciliationCeiling = '0100_execution_artifacts.sql';
        for (const file of files) {
          if (file > reconciliationCeiling) break;
          await client.query(
            'INSERT INTO public.schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING',
            [file],
          );
        }
      } else if (sentinel.early_sentinel) {
        throw new Error(
          'SCHEMA_MIGRATION_HISTORY_INCOMPLETE: legacy schema detected without a latest-generation sentinel; refusing to mark unverified migrations as applied.'
        );
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
        if (err.code === '42P07' || err.code === '42710' || err.code === '42701') {
          console.warn(`[migration] Relation, object, or column in ${file} already exists (${err.code}). Marking ${file} as applied.`);
          await client.query('INSERT INTO public.schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING', [file]);
        } else {
          throw err;
        }
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
