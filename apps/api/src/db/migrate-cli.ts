import 'dotenv/config';
import { initDb, pool } from './index';
import { getMigrationStatus, runMigrations } from './migrator';

async function main() {
  const cmd = String(process.argv[2] || 'up').toLowerCase();
  if (cmd === 'status') {
    const rows = await getMigrationStatus();
    console.table(rows);
    return;
  }
  await initDb();
  const res = await runMigrations();
  console.log('[migrate] complete:', res);
}

main()
  .catch((err) => {
    console.error('[migrate] failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
