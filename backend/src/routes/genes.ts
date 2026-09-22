import { Router } from 'express';
import {
    authenticate,
    requireFreshAccessToken,
    blockUntilPasswordChanged,
} from '../middleware/authMiddleware.js';
import { userRateLimit } from '../middleware/rateLimit.js';
import { getGeneProfile, isAvailable, buildInfo } from '../repositories/geneProfileRepository.js';

/**
 * Gene descriptions for the results screen.
 *
 * Authenticated even though the content is public reference data: the request
 * carries the phenotypes a patient reported, which are clinical data, and an
 * open endpoint would also let anyone enumerate the whole database.
 *
 * The `professional` flag is a display preference, not a permission. Everything
 * it reveals is public NCBI/UniProt/OMIM material; the risk it manages is
 * confusion, not disclosure. It is resolved here rather than in the browser so
 * both views are assembled under one contract.
 */
const router = Router();

const guards = [
    // Keyed by account, not IP: a hospital or university behind one NAT address
    // is many people, and the results screen fans out one request per ranked
    // gene, so a per-IP budget there would throttle colleagues against each
    // other.
    userRateLimit({ windowMs: 60_000, max: 120 }),
    authenticate,
    requireFreshAccessToken,
    blockUntilPasswordChanged,
] as const;

const SYMBOL_RE = /^[A-Za-z0-9._@-]{1,32}$/;
const HPO_RE = /^HP:\d{7}$/i;
const MAX_REPORTED = 100;

function parseReported(raw: unknown): string[] {
    if (typeof raw !== 'string' || raw.length === 0) return [];
    return raw
        .split(',')
        .map((id) => id.trim())
        .filter((id) => HPO_RE.test(id))
        .slice(0, MAX_REPORTED);
}

const MAX_BATCH = 60;

/**
 * Profiles for a whole ranking in one request.
 *
 * The results screen shows up to 50 genes. One request each would spend most of
 * a minute's budget on a single page load and cost 50 round trips for what is a
 * 3 ms read, so the ranking is fetched as a batch.
 */
router.post('/batch', ...guards, (req, res) => {
    const body = req.body as { symbols?: unknown; reported?: unknown; view?: unknown };

    if (!Array.isArray(body?.symbols)) {
        return res.status(400).json({ error: 'symbols debe ser una lista' });
    }

    const symbols = body.symbols
        .filter((s): s is string => typeof s === 'string' && SYMBOL_RE.test(s))
        .slice(0, MAX_BATCH);

    const reported = Array.isArray(body.reported)
        ? body.reported.filter((id): id is string => typeof id === 'string' && HPO_RE.test(id)).slice(0, MAX_REPORTED)
        : [];

    const professional = body.view === 'professional';
    const profiles: Record<string, unknown> = {};

    for (const symbol of symbols) {
        const profile = getGeneProfile(symbol, reported, { professional });
        // Genes without a profile are simply absent: the caller iterates its own
        // ranking and looks up, so a gap here is not a gap on screen.
        if (profile) profiles[profile.simbolo] = profile;
    }

    return res.json({ profiles, disponible: isAvailable() });
});

router.get('/:symbol', ...guards, (req, res) => {
    const { symbol } = req.params;
    // A malformed symbol can never name a real gene, so it is a 404 before any
    // lookup runs — the same ordering the patient routes use for ids.
    if (!SYMBOL_RE.test(symbol)) {
        return res.status(404).json({ error: 'Gen no encontrado' });
    }

    const profile = getGeneProfile(symbol, parseReported(req.query.reported), {
        professional: req.query.view === 'professional',
    });

    if (!profile) {
        // Distinguishable from an unknown gene so the UI can say "no
        // description available" rather than implying the gene is not real.
        return res.status(404).json({
            error: 'Gen sin descripción disponible',
            disponible: isAvailable(),
        });
    }

    return res.json(profile);
});

router.get('/', ...guards, (_req, res) => {
    res.json({ disponible: isAvailable(), build: buildInfo() });
});

export default router;
