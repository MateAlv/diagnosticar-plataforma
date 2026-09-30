import { Router } from 'express';
import {
    authenticate,
    requireFreshAccessToken,
    blockUntilPasswordChanged,
} from '../middleware/authMiddleware.js';
import { userRateLimit } from '../middleware/rateLimit.js';
import { sendError } from '../utils/httpErrors.js';
import { getTermChildren, getTerms } from '../repositories/geneProfileRepository.js';

/**
 * The HPO tree, for turning a general symptom into a more specific one.
 *
 * Public reference data, but authenticated for the same reason as /api/genes:
 * the ids asked about are what a patient reported.
 */
const router = Router();

const guards = [
    // One request per symptom added and one per level browsed; a person
    // refining a history stays far below this.
    userRateLimit({ windowMs: 60_000, max: 120 }),
    authenticate,
    requireFreshAccessToken,
    blockUntilPasswordChanged,
] as const;

const HPO_RE = /^HP:\d{7}$/i;
const MAX_TERMS = 100;

/** GET /api/hpo/terms?ids=HP:0001250,HP:0000054 — how general each term is. */
router.get('/terms', ...guards, (req, res) => {
    const raw = typeof req.query.ids === 'string' ? req.query.ids : '';
    const ids = raw
        .split(',')
        .map((id) => id.trim())
        .filter((id) => HPO_RE.test(id));
    if (ids.length === 0 || ids.length > MAX_TERMS) {
        sendError(res, 400, 'invalid_request', `ids must be 1 to ${MAX_TERMS} HPO ids`);
        return;
    }
    res.json({ terminos: getTerms(ids) });
});

/** GET /api/hpo/terms/HP:0001250/children — the forms beneath a term. */
router.get('/terms/:id/children', ...guards, (req, res) => {
    const id = String(req.params.id ?? '');
    if (!HPO_RE.test(id)) {
        sendError(res, 400, 'invalid_request', 'id must be an HPO id');
        return;
    }
    const result = getTermChildren(id);
    if (!result.termino) {
        sendError(res, 404, 'not_found', 'unknown HPO term');
        return;
    }
    res.json(result);
});

export default router;
