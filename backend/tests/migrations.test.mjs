import './helpers/env.mjs';
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { databaseAvailable, skipReason, closePool } from './helpers/server.mjs';

/**
 * migrate() runs on every backend boot, so it has to survive being run twice
 * and being run twice *at the same time*. The concurrent case is not
 * hypothetical: a rolling restart or `docker compose up --scale backend=2`
 * starts two processes against one database, and `CREATE TABLE IF NOT EXISTS`
 * is not concurrency-safe on its own — both sessions see the table missing and
 * one dies on pg_type's unique index.
 */

const available = await databaseAvailable();
const skip = available ? false : skipReason();

after(async () => { if (available) await closePool(); });

test('migrate is idempotent when run again', { skip }, async () => {
    const { migrate } = await import('../dist/database/pool.js');
    await migrate();
    await migrate();
});

test('concurrent migrations from separate processes do not race', { skip }, async () => {
    // Two things are required to reproduce this, and both are easy to get wrong:
    //
    //   1. Separate processes. Within one process the pg driver interleaves the
    //      statements enough that the race rarely shows.
    //   2. An EMPTY schema. `CREATE TABLE IF NOT EXISTS` only races when the
    //      table is actually absent, so running against the suite's already
    //      migrated database would pass vacuously.
    //
    // Hence a throwaway database of its own. Without the advisory lock in
    // migrate(), this fails with
    // "duplicate key value violates unique constraint pg_type_typname_nsp_index".
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const path = await import('node:path');
    const { fileURLToPath, pathToFileURL } = await import('node:url');
    const execFileAsync = promisify(execFile);

    const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const poolUrl = pathToFileURL(path.join(backendRoot, 'dist/database/pool.js')).href;

    const base = new URL(process.env.DATABASE_URL);
    const scratchName = `diagnosticar_migrace_${Date.now()}`;
    const scratchUrl = new URL(base);
    scratchUrl.pathname = `/${scratchName}`;

    const { pool } = await import('../dist/database/pool.js');
    await pool.query(`CREATE DATABASE ${scratchName}`);

    try {
        const script = `
          const { migrate, pool } = await import(${JSON.stringify(poolUrl)});
          await migrate();
          await pool.end();
        `;
        const run = () =>
            execFileAsync(process.execPath, ['--input-type=module', '-e', script], {
                cwd: backendRoot,
                env: { ...process.env, DATABASE_URL: scratchUrl.toString(), TEST_DATABASE_URL: scratchUrl.toString() },
            });

        const results = await Promise.allSettled([run(), run(), run(), run(), run()]);
        const failures = results
            .filter((r) => r.status === 'rejected')
            .map((r) => `${r.reason?.stderr ?? r.reason?.message ?? r.reason}`
                .trim().split('\n').filter((l) => /error|Error/.test(l)).slice(0, 1).join(' '));

        assert.deepEqual(failures, [], `concurrent migrate() raced on a fresh database:\n  ${failures.join('\n  ')}`);
    } finally {
        await pool.query(`DROP DATABASE IF EXISTS ${scratchName} WITH (FORCE)`).catch(() => {});
    }
});

test('every table and index the app queries exists afterwards', { skip }, async () => {
    const { query } = await import('../dist/database/pool.js');
    for (const table of ['users', 'patients', 'diagnoses', 'question_agent_rounds']) {
        const res = await query('SELECT to_regclass($1) AS t', [`public.${table}`]);
        assert.ok(res.rows[0].t, `table ${table} is missing after migrate()`);
    }
    const idx = await query(
        `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = ANY($1)`,
        [[
            'patients_user_id_idx', 'diagnoses_patient_id_idx', 'diagnoses_user_id_created', 'users_google_id_idx',
            'question_agent_rounds_created_idx', 'question_agent_rounds_user_created_idx',
        ]],
    );
    assert.equal(idx.rows.length, 6, `missing indexes: got ${idx.rows.map((r) => r.indexname).join(', ')}`);
});
