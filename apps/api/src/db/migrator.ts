/**
 * Transactional, advisory-locked SQL migration runner.
 * Tracks applied files in `schema_migrations` with SHA-256 checksums.
 */
import crypto = require('crypto');
import fs = require('fs');
import path = require('path');
import type { PoolClient } from 'pg';
import { pool } from './index';
import { logger } from '../infra/logger';

const MIGRATION_LOCK_KEY = 88421001;

export type MigrationFile = {
  version: string;
  name: string;
  fileName: string;
  filePath: string;
  sql: string;
  checksum: string;
};

export function resolveMigrationsDir(): string {
  const candidates = [
    process.env.MIGRATIONS_DIR,
    path.resolve(__dirname, '../../migrations'),
    path.resolve(process.cwd(), 'migrations'),
    path.resolve(process.cwd(), 'apps/api/migrations'),
  ].filter(Boolean) as string[];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return candidates[0];
}

export function loadMigrationFiles(dir = resolveMigrationsDir()): MigrationFile[] {
  if (!fs.existsSync(dir)) return [];
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^\d+_.*\.sql$/i.test(f))
    .sort((a, b) => a.localeCompare(b));

  return files.map((fileName) => {
    const filePath = path.join(dir, fileName);
    const sql = fs.readFileSync(filePath, 'utf8');
    const idx = fileName.indexOf('_');
    const version = idx > 0 ? fileName.slice(0, idx) : fileName.replace(/\.sql$/i, '');
    const name = fileName.replace(/\.sql$/i, '');
    const checksum = crypto.createHash('sha256').update(sql).digest('hex');
    return { version, name, fileName, filePath, sql, checksum };
  });
}

async function ensureMigrationsTable(client: Pick<PoolClient, 'query'>) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

export async function runMigrations(dir = resolveMigrationsDir()): Promise<{
  applied: string[];
  alreadyApplied: number;
  total: number;
}> {
  const migrations = loadMigrationFiles(dir);
  const client = await pool.connect();
  const applied: string[] = [];
  let alreadyApplied = 0;

  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    await ensureMigrationsTable(client);

    const existingRes = await client.query('SELECT version, name, checksum FROM schema_migrations');
    const existing = new Map<string, { name: string; checksum: string }>(
      (existingRes.rows || []).map((r: any) => [String(r.version), { name: String(r.name), checksum: String(r.checksum) }]),
    );

    for (const m of migrations) {
      const prev = existing.get(m.version);
      if (prev) {
        alreadyApplied += 1;
        if (prev.checksum !== m.checksum) {
          logger.warn(
            { version: m.version, file: m.fileName },
            '[Migrator] checksum differs from applied migration; skipping re-run',
          );
        }
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query(m.sql);
        await client.query(
          'INSERT INTO schema_migrations(version, name, checksum) VALUES($1, $2, $3)',
          [m.version, m.name, m.checksum],
        );
        await client.query('COMMIT');
        applied.push(m.fileName);
        logger.info({ version: m.version, file: m.fileName }, '[Migrator] applied migration');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      }
    }

    return { applied, alreadyApplied, total: migrations.length };
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => {});
    client.release();
  }
}

export async function getMigrationStatus(dir = resolveMigrationsDir()) {
  const migrations = loadMigrationFiles(dir);
  try {
    await ensureMigrationsTable(pool);
    const res = await pool.query('SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version ASC');
    const byVer = new Map<string, any>((res.rows || []).map((r: any) => [String(r.version), r]));
    return migrations.map((m) => {
      const row = byVer.get(m.version);
      return {
        version: m.version,
        name: m.name,
        file: m.fileName,
        applied: !!row,
        applied_at: row?.applied_at || null,
        checksum_match: row ? row.checksum === m.checksum : null,
      };
    });
  } catch (e: any) {
    return migrations.map((m) => ({
      version: m.version,
      name: m.name,
      file: m.fileName,
      applied: false,
      applied_at: null,
      checksum_match: null,
      error: e?.message,
    }));
  }
}
