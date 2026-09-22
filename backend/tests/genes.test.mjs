import './helpers/env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * Gene profiles are read from a SQLite file built outside this repository, so
 * these tests build a small one in a temp directory. No Postgres, no network.
 *
 * The rule under test is the audience split: the family-facing shape must not
 * carry the technical columns, because that is the difference between a
 * readable result and a wall of biochemistry.
 */

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'genes-')), 'genes.db');

function buildFixture() {
    const db = new DatabaseSync(dbPath);
    db.exec(`
        CREATE TABLE genes (
            simbolo TEXT PRIMARY KEY, nombre_completo TEXT, cromosoma TEXT,
            ubicacion TEXT, aliases TEXT, enfermedades_es TEXT, resumen_llano_es TEXT,
            tecnico_resumen_es TEXT, tecnico_funcion_es TEXT, tecnico_resumen_en TEXT,
            tecnico_funcion_en TEXT, ncbi_id TEXT, uniprot_accession TEXT,
            codigo_omim TEXT, referencias TEXT, raw_json TEXT NOT NULL);
        CREATE TABLE sintomas_esperados (
            omim TEXT NOT NULL, hpo_id TEXT NOT NULL, label_en TEXT, label_es TEXT,
            frecuencia_raw TEXT, frecuencia_pct REAL, frecuencia_es TEXT,
            orden INTEGER NOT NULL, PRIMARY KEY (omim, hpo_id));
        CREATE TABLE build_info (clave TEXT PRIMARY KEY, valor TEXT);
    `);
    db.prepare(
        `INSERT INTO genes VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
        'CFTR', 'CF transmembrane conductance regulator', '7', '7q31.2', 'ABCC7',
        JSON.stringify([{ nombre: 'Fibrosis quística', descripcion_es: 'Un trastorno…', omim: '219700' }]),
        'Este gen da las instrucciones para fabricar una proteína.',
        'Texto técnico.', 'CANAL DE CLORURO',
        'ATP-binding cassette', 'Chloride channel',
        '1080', 'P13569', JSON.stringify(['219700']), JSON.stringify({}), '{}',
    );
    const insertSymptom = db.prepare(`INSERT INTO sintomas_esperados VALUES (?,?,?,?,?,?,?,?)`);
    insertSymptom.run('219700', 'HP:0012236', 'Elevated sweat chloride', 'Cloruro en sudor elevado', '77/77', 100.0, '', 0);
    insertSymptom.run('219700', 'HP:0002110', 'Bronchiectasis', 'Bronquiectasias', '106/111', 95.5, '', 1);
    insertSymptom.run('219700', 'HP:0001508', 'Failure to thrive', 'Retraso en el medro', '8/21', 38.1, '', 2);
    db.prepare('INSERT INTO build_info VALUES (?,?)').run('hpo_version', '2026-06-23');
    db.close();
}

buildFixture();
process.env.GENE_PROFILES_DB_PATH = dbPath;
const { getGeneProfile, isAvailable, buildInfo } =
    await import('../dist/repositories/geneProfileRepository.js');

test('the default view carries the curated summary', () => {
    // The Spanish summary is the description everyone reads. What stays behind
    // the toggle is the protein function, the accessions and the English text.
    const profile = getGeneProfile('CFTR');
    assert.equal(profile.resumen_es, 'Texto técnico.');
});

test('the default view never carries the professional-only fields', () => {
    const profile = getGeneProfile('CFTR');
    assert.equal(profile.tecnico, undefined);
    const body = JSON.stringify(profile);
    assert.ok(!body.includes('CANAL DE CLORURO'), 'protein function leaked');
    assert.ok(!body.includes('Chloride channel'), 'English text leaked');
    assert.ok(!body.includes('ABCC7'), 'aliases leaked');
});

test('the professional view adds them', () => {
    const profile = getGeneProfile('CFTR', [], { professional: true });
    assert.equal(profile.tecnico.funcion_proteina_es, 'CANAL DE CLORURO');
    assert.equal(profile.tecnico.resumen_en, 'ATP-binding cassette');
});

test('the disease reaches both audiences — it is the context, not a secret', () => {
    for (const professional of [false, true]) {
        const profile = getGeneProfile('CFTR', [], { professional });
        assert.equal(profile.enfermedades[0].nombre, 'Fibrosis quística');
    }
});

test('reported phenotypes are split from the ones not mentioned', () => {
    const profile = getGeneProfile('CFTR', ['HP:0002110']);
    assert.deepEqual(profile.coincidencias.map((s) => s.nombre), ['Bronquiectasias']);
    assert.deepEqual(
        profile.frecuentes_no_reportados.map((s) => s.nombre),
        ['Cloruro en sudor elevado', 'Retraso en el medro'],
    );
    assert.equal(profile.total_esperados, 3);
});

test('the symptoms not mentioned come back most frequent first', () => {
    // The most frequent unreported symptom is the most useful question to ask.
    const pcts = getGeneProfile('CFTR', []).frecuentes_no_reportados.map((s) => s.frecuencia_pct);
    assert.deepEqual(pcts, [...pcts].sort((a, b) => b - a));
});

test('a reported phenotype matches whatever case it arrives in', () => {
    assert.equal(getGeneProfile('CFTR', ['hp:0012236']).coincidencias.length, 1);
});

test('an unknown gene is null, not an error', () => {
    // Expected: the model can rank a gene newer than this database.
    assert.equal(getGeneProfile('NOTAGENE'), null);
});

test('the symbol lookup is case-insensitive', () => {
    assert.ok(getGeneProfile('cftr'));
});

test('build provenance is readable', () => {
    assert.equal(isAvailable(), true);
    assert.equal(buildInfo().hpo_version, '2026-06-23');
});

test('the route rejects an anonymous caller', async () => {
    // The request carries the phenotypes a patient reported, which are clinical
    // data, and an open endpoint would also let anyone enumerate the database.
    const { startServer } = await import('./helpers/server.mjs');
    const { server, baseUrl, close } = await startServer();
    try {
        const response = await fetch(`${baseUrl}/api/genes/CFTR`);
        assert.equal(response.status, 401);
    } finally {
        await close?.() ?? server?.close();
    }
});
