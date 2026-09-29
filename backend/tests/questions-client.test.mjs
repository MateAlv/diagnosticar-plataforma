import './helpers/env.mjs';
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import http from 'node:http';
import {
    createQuestionAgentClient,
    QuestionAgentHttpError,
    QuestionAgentInvalidResponseError,
    QuestionAgentTimeoutError,
    QuestionAgentUnavailableError,
} from '../dist/services/questionAgentClient.js';

/**
 * The backend's first outbound HTTP call. Each way the agent can fail must
 * surface as one typed error, and none may carry the agent's body along.
 */

let handler = () => ({ status: 200, body: {} });
const received = [];

const upstream = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
        received.push({ url: req.url, method: req.method, headers: req.headers, body: JSON.parse(raw || 'null') });
        const reply = handler();
        if (reply.destroy) {
            req.socket.destroy();
            return;
        }
        if (reply.raw) {
            reply.raw(res);
            return;
        }
        setTimeout(() => {
            res.writeHead(reply.status, { 'Content-Type': 'application/json', ...(reply.headers ?? {}) });
            res.end(typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body));
        }, reply.delayMs ?? 0);
    });
});
await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${upstream.address().port}/`;

after(() => {
    upstream.closeAllConnections();
    upstream.close();
});

const REQUEST = {
    mode: 'paciente',
    round: 1,
    present_hpo_ids: ['HP:0002205'],
    absent_hpo_ids: [],
    answers: [],
    finish: false,
};

const VALID = {
    round: 1,
    mode: 'paciente',
    status: 'questions',
    questions: [{ id: 'q1', hpo_id: 'HP:0001738', label: 'Insuficiencia pancreática exocrina', text: '¿Pregunta?' }],
    ranking: [{ gene_id: 'CFTR', gene_symbol: 'CFTR', score: 0.5, model_score: 0.4, model_rank: 1 }],
    versions: { agent: 'a', knowledge_base: 'k', llm_model: null },
};

const client = (overrides = {}) =>
    createQuestionAgentClient({ baseUrl, token: 'internal-token', timeoutMs: 1_000, ...overrides });

test('posts the request to /v1/rounds with the internal token', async () => {
    handler = () => ({ status: 200, body: VALID });
    received.length = 0;
    const response = await client().requestRound(REQUEST);
    assert.equal(response.questions[0].hpo_id, 'HP:0001738');
    assert.equal(response.questions[0].label, 'Insuficiencia pancreática exocrina');
    assert.equal(response.mode, 'paciente');
    assert.equal(received[0].url, '/v1/rounds');
    assert.equal(received[0].method, 'POST');
    assert.equal(received[0].headers['x-internal-token'], 'internal-token');
    assert.deepEqual(received[0].body, REQUEST);
});

test('answers travel with their earlier reading', async () => {
    handler = () => ({ status: 200, body: { ...VALID, round: 3 } });
    received.length = 0;
    const request = {
        ...REQUEST,
        round: 3,
        answers: [
            {
                hpo_id: 'HP:0001738', answer: 'si', note: 'a veces',
                reading: { effective_answer: 'no_se', note_summary: 'Duda.' },
            },
            { hpo_id: 'HP:0001696', answer: 'no', note: null, reading: null },
        ],
    };
    await client().requestRound(request);
    assert.deepEqual(received[0].body, request);
});

test('omits the token header when none is configured', async () => {
    handler = () => ({ status: 200, body: VALID });
    received.length = 0;
    await client({ token: undefined }).requestRound(REQUEST);
    assert.equal(received[0].headers['x-internal-token'], undefined);
});

test('optional question fields arrive as null, and the gene lists are kept', async () => {
    handler = () => ({
        status: 200,
        body: {
            ...VALID,
            mode: 'medico',
            questions: [{ ...VALID.questions[0], genes_if_yes: ['CFTR', 'SPINK1'], genes_if_no: [] }],
        },
    });
    const response = await client().requestRound({ ...REQUEST, mode: 'medico' });
    assert.deepEqual(response.questions[0].genes_if_yes, ['CFTR', 'SPINK1']);
    assert.deepEqual(response.questions[0].genes_if_no, []);
    assert.equal(response.questions[0].help, null);
    assert.equal(response.questions[0].rationale, null);
    assert.equal(response.finish_reason, null);
    assert.equal(response.summary, null);
});

test('an HTTP error keeps the status, the short code and Retry-After, never the body', async () => {
    const cases = [
        { status: 401, body: { error: 'unauthorized' }, code: 'unauthorized', retry: null },
        { status: 413, body: { error: 'too-large' }, code: 'too-large', retry: null },
        {
            status: 422,
            body: { error: 'invalid-request', detail: [{ msg: 'Traceback: /srv/secret.py LEAK-MARKER' }] },
            code: 'invalid-request',
            retry: null,
        },
        { status: 422, body: { error: 'no-known-hpo-ids' }, code: 'no-known-hpo-ids', retry: null },
        { status: 503, body: { error: 'busy' }, headers: { 'Retry-After': '7' }, code: 'busy', retry: 7 },
        {
            status: 503, body: { error: 'model-unavailable' }, headers: { 'Retry-After': 'soon' },
            code: 'model-unavailable', retry: null,
        },
        { status: 500, body: { error: 'Traceback: /srv/secret.py LEAK-MARKER' }, code: null, retry: null },
        { status: 502, body: '<html>LEAK-MARKER</html>', code: null, retry: null },
        { status: 500, body: { error: 'x'.repeat(10_000) }, code: null, retry: null },
    ];
    for (const c of cases) {
        handler = () => ({ status: c.status, body: c.body, headers: c.headers });
        await assert.rejects(client().requestRound(REQUEST), (error) => {
            assert.ok(error instanceof QuestionAgentHttpError, `HTTP ${c.status}`);
            assert.ok(error instanceof QuestionAgentUnavailableError);
            assert.equal(error.name, 'QuestionAgentHttpError');
            assert.equal(error.status, c.status);
            assert.equal(error.code, c.code, `HTTP ${c.status}`);
            assert.equal(error.retryAfterSeconds, c.retry);
            assert.ok(!error.message.includes('LEAK-MARKER'));
            assert.ok(!JSON.stringify(error).includes('LEAK-MARKER'));
            return true;
        });
    }
});

test('a dropped connection is "unavailable"', async () => {
    handler = () => ({ destroy: true });
    await assert.rejects(client().requestRound(REQUEST), (error) => {
        assert.ok(error instanceof QuestionAgentUnavailableError);
        assert.ok(!(error instanceof QuestionAgentHttpError));
        return true;
    });
});

test('a slow agent is a timeout', async () => {
    handler = () => ({ status: 200, body: VALID, delayMs: 800 });
    await assert.rejects(client({ timeoutMs: 200 }).requestRound(REQUEST), QuestionAgentTimeoutError);
});

test('a 200 that breaks the contract is an invalid response', async () => {
    const bodies = [
        'not json at all LEAK-MARKER',
        { ...VALID, ranking: 'LEAK-MARKER' },
        { ...VALID, round: 2 },
        { ...VALID, status: 'maybe' },
        { ...VALID, mode: undefined },
        { ...VALID, mode: 'medico' },
        { ...VALID, questions: [{ id: 'q1', hpo_id: 'HP:0001738', text: '¿Pregunta?' }] },
        { ...VALID, questions: [{ ...VALID.questions[0], label: '' }] },
        { ...VALID, questions: [{ ...VALID.questions[0], genes_if_yes: ['A', 'B', 'C', 'D', 'E', 'F'] }] },
        { ...VALID, questions: [{ ...VALID.questions[0], genes_if_no: 'CFTR' }] },
    ];
    for (const body of bodies) {
        handler = () => ({ status: 200, body });
        await assert.rejects(client().requestRound(REQUEST), (error) => {
            assert.ok(error instanceof QuestionAgentInvalidResponseError, JSON.stringify(body));
            assert.ok(!error.message.includes('LEAK-MARKER'));
            return true;
        });
    }
});

test('unknown upstream fields are dropped, not stored', async () => {
    handler = () => ({
        status: 200,
        body: {
            ...VALID,
            debug_prompt: 'LEAK-MARKER',
            questions: [{ ...VALID.questions[0], separates: ['LEAK-MARKER'] }],
        },
    });
    const response = await client().requestRound(REQUEST);
    assert.ok(!JSON.stringify(response).includes('LEAK-MARKER'));
});

test('a declared oversized body is refused without waiting for it', async () => {
    handler = () => ({
        raw: (res) => {
            res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': String(5_000_000) });
            res.write('{"round":');
            // Never finishes: only the Content-Length check can end this call in time.
        },
    });
    const started = Date.now();
    await assert.rejects(client({ timeoutMs: 5_000 }).requestRound(REQUEST), /too large/);
    assert.ok(Date.now() - started < 2_000, 'the client waited for the oversized body');
});

test('a streamed body past the cap is cut off', async () => {
    handler = () => ({
        raw: (res) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            const chunk = 'x'.repeat(64 * 1024);
            let sent = 0;
            const push = () => {
                if (res.destroyed || sent > 4_000_000) return res.end();
                sent += chunk.length;
                res.write(chunk, push);
                return undefined;
            };
            push();
        },
    });
    await assert.rejects(client({ timeoutMs: 5_000 }).requestRound(REQUEST), (error) => {
        assert.ok(error instanceof QuestionAgentInvalidResponseError);
        assert.match(error.message, /too large/);
        return true;
    });
});
