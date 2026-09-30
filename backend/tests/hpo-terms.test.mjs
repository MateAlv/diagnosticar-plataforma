import './helpers/env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * The HPO tree behind the wizard's "too general" dialog: how many genes a term
 * reaches, and which forms beneath it are worth offering.
 */

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hpo-tree-')), 'genes.db');

// Convulsiones ─┬─ Convulsiones focales ── Crisis focales conscientes
//               ├─ Convulsiones generalizadas
//               └─ Convulsión refleja (reaches no gene)
function buildFixture() {
    const db = new DatabaseSync(dbPath);
    db.exec(`
        CREATE TABLE build_info (clave TEXT PRIMARY KEY, valor TEXT);
        CREATE TABLE hpo_terminos (hpo_id TEXT PRIMARY KEY, nombre TEXT NOT NULL, nombre_en TEXT);
        CREATE TABLE hpo_hijos (padre TEXT NOT NULL, hijo TEXT NOT NULL, PRIMARY KEY (padre, hijo));
        CREATE TABLE termino_cobertura (hpo_id TEXT PRIMARY KEY, genes INTEGER NOT NULL);
    `);
    const term = db.prepare('INSERT INTO hpo_terminos VALUES (?, ?, ?)');
    term.run('HP:0001250', 'Convulsiones', 'Seizure');
    term.run('HP:0007359', 'Convulsiones focales', 'Focal-onset seizure');
    term.run('HP:0002197', 'Convulsiones generalizadas', 'Generalized-onset seizure');
    term.run('HP:0020217', 'Convulsión refleja', 'Reflex seizure');
    term.run('HP:0032677', 'Crisis focales conscientes', 'Focal aware seizure');
    const edge = db.prepare('INSERT INTO hpo_hijos VALUES (?, ?)');
    edge.run('HP:0001250', 'HP:0007359');
    edge.run('HP:0001250', 'HP:0002197');
    edge.run('HP:0001250', 'HP:0020217');
    edge.run('HP:0007359', 'HP:0032677');
    const coverage = db.prepare('INSERT INTO termino_cobertura VALUES (?, ?)');
    coverage.run('HP:0001250', 1560);
    coverage.run('HP:0007359', 238);
    coverage.run('HP:0002197', 252);
    coverage.run('HP:0032677', 12);
    db.close();
}

buildFixture();
process.env.GENE_PROFILES_DB_PATH = dbPath;
const { getTerms, getTermChildren } = await import('../dist/repositories/geneProfileRepository.js');

test('a term reports how many genes it reaches and whether it can be refined', () => {
    const [seizure] = getTerms(['HP:0001250']);
    assert.deepEqual(seizure, {
        hpo_id: 'HP:0001250', nombre: 'Convulsiones', genes: 1560, tiene_hijos: true,
    });
});

test('terms come back in the order asked, unknown ones left out', () => {
    const terms = getTerms(['HP:0002197', 'HP:9999999', 'hp:0001250']);
    assert.deepEqual(terms.map((t) => t.hpo_id), ['HP:0002197', 'HP:0001250']);
});

test('a leaf cannot be refined', () => {
    assert.equal(getTerms(['HP:0032677'])[0].tiene_hijos, false);
    assert.equal(getTerms(['HP:0002197'])[0].tiene_hijos, false);
});

test('children reaching most genes come first, and none that reach no gene', () => {
    const { termino, hijos } = getTermChildren('HP:0001250');
    assert.equal(termino.nombre, 'Convulsiones');
    assert.deepEqual(hijos.map((h) => [h.nombre, h.genes]), [
        ['Convulsiones generalizadas', 252],
        ['Convulsiones focales', 238],
    ]);
    assert.equal(hijos.find((h) => h.hpo_id === 'HP:0007359').tiene_hijos, true);
});

test('an unknown term has no children and no summary', () => {
    assert.deepEqual(getTermChildren('HP:9999999'), { termino: null, hijos: [] });
});

test('the routes reject an anonymous caller', async () => {
    // The ids asked about are what a patient reported.
    const { startServer } = await import('./helpers/server.mjs');
    const { server, baseUrl, close } = await startServer();
    try {
        for (const url of ['/api/hpo/terms?ids=HP:0001250', '/api/hpo/terms/HP:0001250/children']) {
            const response = await fetch(`${baseUrl}${url}`);
            assert.equal(response.status, 401, url);
        }
    } finally {
        await close?.() ?? server?.close();
    }
});

test('a database without the tree answers with nothing to refine', () => {
    // The file is copied to the node by hand, so one built before the tree can
    // be mounted at any time; the wizard must simply not flag anything. Run in
    // a child process: the connection is opened once per process.
    const legacyPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hpo-old-')), 'genes.db');
    const legacy = new DatabaseSync(legacyPath);
    legacy.exec('CREATE TABLE build_info (clave TEXT PRIMARY KEY, valor TEXT);');
    legacy.close();
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', `
        process.env.GENE_PROFILES_DB_PATH = ${JSON.stringify(legacyPath)};
        const { getTerms, getTermChildren } = await import(${JSON.stringify(
            new URL('../dist/repositories/geneProfileRepository.js', import.meta.url).href,
        )});
        console.log(JSON.stringify([getTerms(['HP:0001250']), getTermChildren('HP:0001250')]));
    `], { env: { ...process.env }, encoding: 'utf8' });
    assert.deepEqual(JSON.parse(out.trim().split('\n').pop()), [[], { termino: null, hijos: [] }]);
});
