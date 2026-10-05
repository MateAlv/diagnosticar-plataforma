import './helpers/env.mjs';
import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import {
    databaseAvailable, skipReason, startServer, createClient,
    seedUser, authenticateClient, deleteUser, closePool,
} from './helpers/server.mjs';

/**
 * The age a symptom began is stored inside each entry of `symptoms_extracted`
 * (jsonb), so it needs no column and no migration: it comes back as saved on
 * the list, on the patient's latest diagnosis, and through a regeneration. A
 * symptom saved without it reads back without it.
 */

const available = await databaseAvailable();
const skip = available ? false : skipReason();

let server;
let user;
let client;

const onset = { hpo_id: 'HP:0003593', age_years: 0.5 };
const payload = () => ({
    nombre: 'Paciente con inicio',
    fechaNacimiento: '2015-04-03',
    sexo: 'F',
    historiaClinica: 'Convulsiones desde los seis meses.',
    symptomsExtracted: [
        { description: 'Convulsiones', code: 'HP:0001250', onset },
        { description: 'Fatiga', code: 'HP:0012378' },
    ],
    phenotypes: [],
    genphenGenes: [],
});

before(async () => {
    if (!available) return;
    server = await startServer();
    user = await seedUser();
    client = authenticateClient(createClient(server.baseUrl), user);
});

after(async () => {
    if (!available) return;
    await deleteUser(user.id);
    await server.close();
    await closePool();
});

test('a symptom\'s onset is saved with it and read back as sent', { skip }, async () => {
    const created = await client.post('/api/patients', payload());
    assert.equal(created.status, 201, created.text);
    const list = await client.get(`/api/patients/${created.json.patient.id}/diagnoses`);
    assert.equal(list.status, 200);
    const [seizure, fatigue] = list.json[0].symptoms_extracted;
    assert.deepEqual(seizure.onset, onset);
    assert.equal('onset' in fatigue, false);
});

test('a regenerated diagnosis keeps the onset it is given', { skip }, async () => {
    const created = await client.post('/api/patients', payload());
    const body = payload();
    body.symptomsExtracted[0].onset = { hpo_id: 'HP:0011463', age_years: 3 };
    delete body.nombre; delete body.fechaNacimiento; delete body.sexo;
    const again = await client.post(`/api/patients/${created.json.patient.id}/diagnoses`, body);
    assert.equal(again.status, 201, again.text);
    const list = await client.get(`/api/patients/${created.json.patient.id}/diagnoses`);
    const stored = list.json.flatMap((d) => d.symptoms_extracted.map((s) => s.onset?.hpo_id));
    assert.ok(stored.includes('HP:0011463') && stored.includes('HP:0003593'));
});
