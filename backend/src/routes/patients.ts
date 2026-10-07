import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import {
    authenticate,
    requireFreshAccessToken,
    blockUntilPasswordChanged,
    type AuthRequest,
} from '../middleware/authMiddleware.js';
import { userRateLimit } from '../middleware/rateLimit.js';
import {
    createPatientWithDiagnosis,
    getPatientsByUser,
    getPatientById,
    deletePatient,
} from '../repositories/patientRepository.js';
import {
    createDiagnosisForPatient,
    getDiagnosesByPatient,
    getDiagnosisById,
} from '../repositories/diagnosisRepository.js';
import { logError } from '../utils/logError.js';
import { stripNullBytes } from '../utils/sanitize.js';
import { internalError, sendError } from '../utils/httpErrors.js';

const router = Router();

// Keyed by account, not IP: these routes are all behind authentication, where
// an IP key both lets one account rotate addresses for a fresh budget and
// punishes everyone sharing a hospital or university NAT.
const writeLimit = userRateLimit({ windowMs: 60 * 60_000, max: 60 });
const readLimit = userRateLimit({ windowMs: 60_000, max: 120 });

const uuidSchema = z.string().uuid();

/**
 * `id` and `diagId` are interpolated into UUID columns. Postgres raises 22P02
 * on anything that is not a UUID, which the route handlers would surface as a
 * 500. A non-UUID can never name a row that exists, so it is a 404 — that also
 * keeps malformed input out of the error log.
 */
function rejectNonUuid(req: Request, res: Response, next: NextFunction, value: string) {
    if (!uuidSchema.safeParse(value).success) {
        return sendError(res, 404, 'not_found', 'Not found');
    }
    return next();
}

router.param('id', rejectNonUuid);
router.param('diagId', rejectNonUuid);

const historiaClinicaSchema = z
    .string()
    .optional()
    .nullable()
    // Empty when nothing was written. This used to store our own sentence
    // instead, which then read — and was re-submitted on regeneration — as
    // the family's clinical history. The column is NOT NULL, so '' it is.
    .transform((value) => (typeof value === 'string' ? stripNullBytes(value).trim() : ''))
    // The wizard caps the text at 10,000 characters; the server holds the same line.
    .refine((value) => value.length <= 10_000);

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar date, not in the future and at most 120 years back, or nothing. */
const birthDateSchema = z
    .string()
    .nullable()
    .optional()
    .transform((value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null))
    .refine((value) => {
        if (value === null) return true;
        const match = ISO_DATE.exec(value);
        if (!match) return false;
        const [year, month, day] = match.slice(1).map(Number);
        const date = new Date(Date.UTC(year, month - 1, day));
        if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return false;
        const now = new Date();
        return date.getTime() <= now.getTime() && year >= now.getUTCFullYear() - 120;
    });

const createPatientSchema = z.object({
    // Patient demographics
    // Optional: left empty, the patient is numbered «Paciente N» in its account.
    nombre: z.string().trim().max(255).nullable().optional(),
    fechaNacimiento: birthDateSchema,
    sexo: z.string().max(50).nullable().optional(),
    localidad: z.string().max(255).nullable().optional(),
    pais: z.string().max(100).nullable().optional(),
    // Diagnosis data
    historiaClinica: historiaClinicaSchema,
    symptomsExtracted: z.array(z.any()).default([]),
    phenotypes: z.array(z.any()).default([]),
    genphenGenes: z.array(z.any()).default([]),
    genphenSpecialties: z.any().optional(),
    genphenConfidence: z.number().nullable().optional(),
});

const createDiagnosisSchema = z.object({
    historiaClinica: historiaClinicaSchema,
    symptomsExtracted: z.array(z.any()).default([]),
    phenotypes: z.array(z.any()).default([]),
    genphenGenes: z.array(z.any()).default([]),
    genphenSpecialties: z.any().optional(),
    genphenConfidence: z.number().nullable().optional(),
});

// POST /api/patients — create patient + diagnosis atomically
router.post(
    '/',
    // The costliest route in the app: it writes clinical data and drives the
    // GPU model behind it. Generous for a person filling in one wizard, cheap
    // protection against a script.
    writeLimit,
    authenticate,
    requireFreshAccessToken,
    blockUntilPasswordChanged,
    async (req: AuthRequest, res: Response) => {
        const parsed = createPatientSchema.safeParse(req.body);
        if (!parsed.success) {
            return sendError(res, 400, 'invalid_request', 'Invalid request');
        }

        // The HPO/GenPhenAI arrays land in jsonb, which rejects NUL as hard as
        // text does, so the whole payload is scrubbed rather than just the free text.
        const { nombre, fechaNacimiento, sexo, localidad, pais,
                historiaClinica, symptomsExtracted, phenotypes,
                genphenGenes, genphenSpecialties, genphenConfidence } = stripNullBytes(parsed.data);

        const userId = req.userRecord!.id;
        const userEmail = req.userRecord!.email ?? null;

        try {
            const result = await createPatientWithDiagnosis(
                userId,
                userEmail,
                { nombre, fechaNacimiento, sexo, localidad, pais },
                { historiaClinica, symptomsExtracted, phenotypes, genphenGenes, genphenSpecialties, genphenConfidence },
            );
            return res.status(201).json(result);
        } catch (err) {
            logError('POST /api/patients error', err);
            return internalError(res);
        }
    },
);

// POST /api/patients/:id/diagnoses — create a new diagnosis for an existing patient
router.post(
    '/:id/diagnoses',
    writeLimit,
    authenticate,
    requireFreshAccessToken,
    blockUntilPasswordChanged,
    async (req: AuthRequest, res: Response) => {
        const parsed = createDiagnosisSchema.safeParse(req.body);
        if (!parsed.success) {
            return sendError(res, 400, 'invalid_request', 'Invalid request');
        }

        const userId = req.userRecord!.id;
        const userEmail = req.userRecord!.email ?? null;

        try {
            const patient = await getPatientById(req.params.id, userId);
            if (!patient) {
                return sendError(res, 404, 'not_found', 'Not found');
            }

            const {
                historiaClinica,
                symptomsExtracted,
                phenotypes,
                genphenGenes,
                genphenSpecialties,
                genphenConfidence,
            } = stripNullBytes(parsed.data);

            const result = await createDiagnosisForPatient(
                req.params.id,
                userId,
                userEmail,
                {
                    historiaClinica,
                    symptomsExtracted,
                    phenotypes,
                    genphenGenes,
                    genphenSpecialties,
                    genphenConfidence,
                },
            );

            return res.status(201).json(result);
        } catch (err) {
            logError('POST /api/patients/:id/diagnoses error', err);
            return internalError(res);
        }
    },
);

// GET /api/patients — list all patients for authenticated user
router.get(
    '/',
    readLimit,
    authenticate,
    requireFreshAccessToken,
    blockUntilPasswordChanged,
    async (req: AuthRequest, res: Response) => {
        try {
            const patients = await getPatientsByUser(req.userRecord!.id);
            return res.json(patients);
        } catch (err) {
            logError('GET /api/patients error', err);
            return internalError(res);
        }
    },
);

// GET /api/patients/:id — single patient (ownership enforced)
router.get(
    '/:id',
    readLimit,
    authenticate,
    requireFreshAccessToken,
    blockUntilPasswordChanged,
    async (req: AuthRequest, res: Response) => {
        try {
            const patient = await getPatientById(req.params.id, req.userRecord!.id);
            if (!patient) return sendError(res, 404, 'not_found', 'Not found');
            return res.json(patient);
        } catch (err) {
            logError('GET /api/patients/:id error', err);
            return internalError(res);
        }
    },
);

// DELETE /api/patients/:id — delete patient and all diagnoses (cascade)
router.delete(
    '/:id',
    writeLimit,
    authenticate,
    requireFreshAccessToken,
    blockUntilPasswordChanged,
    async (req: AuthRequest, res: Response) => {
        try {
            const deleted = await deletePatient(req.params.id, req.userRecord!.id);
            if (!deleted) return sendError(res, 404, 'not_found', 'Not found');
            return res.status(204).send();
        } catch (err) {
            logError('DELETE /api/patients/:id error', err);
            return internalError(res);
        }
    },
);

// GET /api/patients/:id/diagnoses — list diagnoses for a patient
router.get(
    '/:id/diagnoses',
    readLimit,
    authenticate,
    requireFreshAccessToken,
    blockUntilPasswordChanged,
    async (req: AuthRequest, res: Response) => {
        // Verify patient ownership first
        let patient;
        try {
            patient = await getPatientById(req.params.id, req.userRecord!.id);
        } catch (err) {
            logError('GET /api/patients/:id/diagnoses ownership check error', err);
            return internalError(res);
        }
        if (!patient) return sendError(res, 404, 'not_found', 'Not found');

        try {
            const diagnoses = await getDiagnosesByPatient(req.params.id, req.userRecord!.id);
            return res.json(diagnoses);
        } catch (err) {
            logError('GET /api/patients/:id/diagnoses error', err);
            return internalError(res);
        }
    },
);

// GET /api/patients/:id/diagnoses/:diagId — single diagnosis (full data)
router.get(
    '/:id/diagnoses/:diagId',
    readLimit,
    authenticate,
    requireFreshAccessToken,
    blockUntilPasswordChanged,
    async (req: AuthRequest, res: Response) => {
        try {
            const diagnosis = await getDiagnosisById(req.params.diagId, req.userRecord!.id);
            if (!diagnosis || diagnosis.patient_id !== req.params.id) {
                return sendError(res, 404, 'not_found', 'Not found');
            }
            return res.json(diagnosis);
        } catch (err) {
            logError('GET /api/patients/:id/diagnoses/:diagId error', err);
            return internalError(res);
        }
    },
);

export default router;
