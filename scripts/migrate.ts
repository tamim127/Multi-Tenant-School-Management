import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { Client } from 'pg';

async function main() {
  if (!process.env.MIGRATION_DATABASE_URL) throw new Error('MIGRATION_DATABASE_URL required');
  const db = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await db.connect();
  try {
    await db.query('SELECT pg_advisory_lock(17290001)');
    await db.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    for (const version of (await readdir('migrations'))
      .filter((f) => /^\d{4}_.+\.sql$/.test(f))
      .sort()) {
      const sql = await readFile(`migrations/${version}`, 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const existing = await db.query('SELECT checksum FROM schema_migrations WHERE version=$1', [
        version,
      ]);
      if (existing.rowCount) {
        if (existing.rows[0].checksum !== checksum)
          throw new Error(`Migration checksum mismatch: ${version}`);
        continue;
      }
      await db.query('BEGIN');
      try {
        await db.query(sql);
        await db.query('INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)', [
          version,
          checksum,
        ]);
        await db.query('COMMIT');
        console.log(`Applied ${version}`);
      } catch (error) {
        await db.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await db.end();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
