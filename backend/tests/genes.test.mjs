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
        CREATE TABLE hpo_ancestros (
            hpo_id TEXT NOT NULL, ancestro_id TEXT NOT NULL, distancia INTEGER NOT NULL,
            PRIMARY KEY (hpo_id, ancestro_id));
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

    // A second gene, for the graph matching and the per-condition counts: two
    // conditions where the *second* is the one a febrile, seizing child fits.
    db.prepare(`INSERT INTO genes VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        'SCN1A', 'Sodium voltage-gated channel alpha subunit 1', '2', '2q24.3', 'NAC1',
        JSON.stringify([
            { nombre: 'Migraña hemipléjica familiar 3', descripcion_es: 'Migraña…', omim: '609634' },
            { nombre: 'Encefalopatía epiléptica del desarrollo 6', descripcion_es: 'Epilepsia…', omim: '607208' },
        ]),
        'Resumen llano.', 'Texto técnico SCN1A.', 'CANAL DE SODIO',
        'Sodium channel', 'Sodium channel function',
        '6323', 'P35498', JSON.stringify(['609634', '607208']), JSON.stringify({}), '{}',
    );
    insertSymptom.run('609634', 'HP:0002315', 'Headache', 'Cefalea', '10/10', 100.0, '', 0);
    insertSymptom.run('607208', 'HP:0002373', 'Febrile seizure', 'Convulsiones febriles', '20/20', 100.0, '', 0);
    insertSymptom.run('607208', 'HP:0012469', 'Infantile spasms', 'Espasmos infantiles', '9/20', 45.0, '', 1);
    insertSymptom.run('607208', 'HP:0001263', 'Global developmental delay', 'Retardo global del desarrollo', '18/20', 90.0, '', 2);

    // Both seizure subtypes sit under HP:0001250 "Convulsiones", which is what
    // the extractor returns when a family writes "convulsiones".
    const insertAncestor = db.prepare('INSERT INTO hpo_ancestros VALUES (?,?,?)');
    insertAncestor.run('HP:0002373', 'HP:0001250', 3);
    insertAncestor.run('HP:0012469', 'HP:0001250', 3);
    insertAncestor.run('HP:0002315', 'HP:0000118', 2);

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

// --- Matching a general report against specific annotations -----------------

test('a reported general phenotype matches the specific ones beneath it', () => {
    // The whole reason this exists: families write "convulsiones" and the
    // extractor returns HP:0001250, while diseases are annotated with
    // "Convulsiones febriles" and "Espasmos infantiles". Comparing ids exactly
    // matched nothing, so every gene on the results screen read
    // "sin coincidencias" even where the overlap was real.
    const profile = getGeneProfile('SCN1A', ['HP:0001250']);
    const names = profile.coincidencias.map((s) => s.nombre).sort();
    assert.deepEqual(names, ['Convulsiones febriles', 'Espasmos infantiles']);
});

test('a graph match records what it matched, an exact one does not', () => {
    // "You said fiebre; this condition causes fiebre episódica" is information
    // worth showing, so the specific-vs-general distinction is not thrown away.
    const profile = getGeneProfile('SCN1A', ['HP:0001250', 'HP:0001263']);
    const exact = profile.coincidencias.find((s) => s.hpo_id === 'HP:0001263');
    const viaGraph = profile.coincidencias.find((s) => s.hpo_id === 'HP:0002373');

    assert.equal(exact.coincide_con, undefined);
    assert.deepEqual(viaGraph.coincide_con, { hpo_id: 'HP:0001250', distancia: 3 });
});

test('a matched symptom is not also listed as one to ask about', () => {
    const profile = getGeneProfile('SCN1A', ['HP:0001250']);
    const asked = profile.frecuentes_no_reportados.map((s) => s.hpo_id);
    for (const match of profile.coincidencias) {
        assert.ok(!asked.includes(match.hpo_id), `${match.hpo_id} in both lists`);
    }
});

test('an unrelated report matches nothing', () => {
    const profile = getGeneProfile('SCN1A', ['HP:0004322']);
    assert.deepEqual(profile.coincidencias, []);
});

test('only edges present in the closure can match', () => {
    // The near-root guard is applied when the closure is built, not here:
    // `hpo_ancestros` simply does not contain edges through terms like
    // "Phenotypic abnormality", whose 18,708 descendants would otherwise make
    // every gene match every symptom. This pins the query side of that
    // contract — it matches exactly what the table says and nothing more.
    const viaMissingEdge = getGeneProfile('SCN1A', ['HP:0001250']);
    assert.ok(
        !viaMissingEdge.coincidencias.some((s) => s.hpo_id === 'HP:0001263'),
        'HP:0001263 has no edge to HP:0001250 in the fixture and must not match',
    );
});

test('matching the other direction does not count', () => {
    // The family reports the *specific* term; claiming a match on the general
    // one would dress a weaker relationship up as the same thing.
    const profile = getGeneProfile('CFTR', ['HP:0012236']);
    assert.equal(profile.coincidencias.length, 1);
    assert.equal(profile.coincidencias[0].hpo_id, 'HP:0012236');
});

test('a database with no graph table still matches exactly', async () => {
    // The file is copied to the node by hand, so a build predating the graph
    // can be mounted at any time. It must fall back to exact matching rather
    // than failing every request.
    //
    // Run in a child process: the connection and the configured path are both
    // resolved once per process, so this cannot be exercised in-process.
    const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'genes-old-'));
    const legacyPath = path.join(legacyDir, 'genes.db');
    const legacy = new DatabaseSync(legacyPath);
    legacy.exec(`
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
    legacy.prepare(`INSERT INTO genes VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        'SCN1A', null, '2', '2q24.3', null,
        JSON.stringify([{ nombre: 'Epilepsia', descripcion_es: '', omim: '607208' }]),
        null, 'Resumen.', null, null, null, null, null,
        JSON.stringify(['607208']), JSON.stringify({}), '{}',
    );
    legacy.prepare(`INSERT INTO sintomas_esperados VALUES (?,?,?,?,?,?,?,?)`)
        .run('607208', 'HP:0002373', 'Febrile seizure', 'Convulsiones febriles', '20/20', 100.0, '', 0);
    legacy.close();

    const { execFileSync } = await import('node:child_process');
    const probe = `
        const { getGeneProfile } = await import('../dist/repositories/geneProfileRepository.js');
        console.log(JSON.stringify({
            general: getGeneProfile('SCN1A', ['HP:0001250']).coincidencias.length,
            exact: getGeneProfile('SCN1A', ['HP:0002373']).coincidencias.length,
        }));
    `;
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', probe], {
        cwd: path.dirname(new URL(import.meta.url).pathname),
        env: { ...process.env, GENE_PROFILES_DB_PATH: legacyPath },
        encoding: 'utf8',
    });

    const result = JSON.parse(output.trim().split('\n').pop());
    assert.equal(result.general, 0, 'no graph, so a general term must not match');
    assert.equal(result.exact, 1, 'exact matching must still work');
});

// --- Naming the condition that is actually relevant ------------------------

test('each condition reports how much of the report it accounts for', () => {
    // The screen showed enfermedades[0] from an unordered list, so a child with
    // seizures was told the gene was about hemiplegic migraine.
    const profile = getGeneProfile('SCN1A', ['HP:0001250', 'HP:0001263']);
    const counts = Object.fromEntries(
        profile.enfermedades.map((d) => [d.nombre, d.coincidencias]),
    );
    assert.equal(counts['Migraña hemipléjica familiar 3'], 0);
    assert.equal(counts['Encefalopatía epiléptica del desarrollo 6'], 3);
});

test('conditions keep their original order', () => {
    // Sorting them would read as a differential the model never produced.
    const profile = getGeneProfile('SCN1A', ['HP:0001250', 'HP:0001263']);
    assert.deepEqual(
        profile.enfermedades.map((d) => d.omim),
        ['609634', '607208'],
    );
});

test('conditions carry no count when nothing was reported', () => {
    const profile = getGeneProfile('SCN1A');
    assert.equal(profile.enfermedades[0].coincidencias, undefined);
});

test('coverage counts reported things engaged, not symptoms matched', () => {
    // The screen says "2 de 4 cosas que contaste", and the denominator is the
    // reader's own report so they can check it. A gene matching several
    // annotated symptoms that all trace back to one thing they said engages
    // one thing, not several — counting symptoms would overstate the overlap.
    const profile = getGeneProfile('SCN1A', ['HP:0001250', 'HP:0001263']);

    assert.equal(profile.coincidencias.length, 3);
    assert.deepEqual(profile.reportados_cubiertos.sort(), ['HP:0001250', 'HP:0001263']);
});

test('coverage is empty when nothing matched', () => {
    assert.deepEqual(getGeneProfile('SCN1A', ['HP:0004322']).reportados_cubiertos, []);
});

test('matches are grouped by the reported term, not listed flat', () => {
    // "Convulsiones" subsumes both of SCN1A's seizure annotations. Listing them
    // flat made one thing the family said look like two pieces of evidence.
    const profile = getGeneProfile('SCN1A', ['HP:0001250']);

    assert.equal(profile.coincidencias.length, 2);
    assert.equal(profile.coincidencias_por_reporte.length, 1);

    const [group] = profile.coincidencias_por_reporte;
    assert.equal(group.reportado_hpo_id, 'HP:0001250');
    assert.equal(group.exacta, null, 'nothing reported matched exactly');
    assert.equal(group.especificas.length, 2);
});

test('an exact match is kept apart from the terms beneath it', () => {
    // The distinction is the point: what they reported is evidence, what sits
    // under it in the ontology is our inference — and often more severe than
    // the words they used.
    const profile = getGeneProfile('SCN1A', ['HP:0001250', 'HP:0001263']);
    const group = profile.coincidencias_por_reporte.find(
        (entry) => entry.reportado_hpo_id === 'HP:0001263',
    );

    assert.equal(group.exacta.nombre, 'Retardo global del desarrollo');
    assert.deepEqual(group.especificas, []);
});

test('an exact match sorts before a group that only has specific forms', () => {
    const profile = getGeneProfile('SCN1A', ['HP:0001250', 'HP:0001263']);
    assert.ok(profile.coincidencias_por_reporte[0].exacta, 'exact group must lead');
});
