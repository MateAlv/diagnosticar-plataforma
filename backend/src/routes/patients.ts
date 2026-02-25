import { Router, type Response } from 'express';
import { z } from 'zod';
import { authenticate, requireFreshAccessToken, type AuthRequest } from '../middleware/authMiddleware.js';
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

const router = Router();

const createPatientSchema = z.object({
    // Patient demographics
    nombre: z.string().trim().min(1).max(255),
    fechaNacimiento: z.string().nullable().optional(),
    sexo: z.string().max(50).nullable().optional(),
    localidad: z.string().max(255).nullable().optional(),
    pais: z.string().max(100).nullable().optional(),
    // Diagnosis data
    historiaClinica: z.string().min(1),
    symptomsExtracted: z.array(z.any()).default([]),
    phenotypes: z.array(z.any()).default([]),
    genphenGenes: z.array(z.any()).default([]),
    genphenSpecialties: z.any().optional(),
    genphenConfidence: z.number().nullable().optional(),
});

const createDiagnosisSchema = z.object({
    historiaClinica: z.string().min(1),
    symptomsExtracted: z.array(z.any()).default([]),
    phenotypes: z.array(z.any()).default([]),
    genphenGenes: z.array(z.any()).default([]),
    genphenSpecialties: z.any().optional(),
    genphenConfidence: z.number().nullable().optional(),
});

// POST /api/patients — create patient + diagnosis atomically
router.post(
    '/',
    authenticate,
    requireFreshAccessToken,
    async (req: AuthRequest, res: Response) => {
        const parsed = createPatientSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
        }

        const { nombre, fechaNacimiento, sexo, localidad, pais,
                historiaClinica, symptomsExtracted, phenotypes,
                genphenGenes, genphenSpecialties, genphenConfidence } = parsed.data;

        const userId = req.userRecord!.id;
        const userEmail = req.userRecord!.email ?? null;
        const sourceIp = (req.ip ?? req.socket.remoteAddress) ?? null;
        const userAgent = req.headers['user-agent'] ?? null;

        try {
            const result = await createPatientWithDiagnosis(
                userId,
                userEmail,
                { nombre, fechaNacimiento, sexo, localidad, pais },
                { historiaClinica, symptomsExtracted, phenotypes, genphenGenes, genphenSpecialties, genphenConfidence },
                sourceIp,
                userAgent,
            );
            return res.status(201).json(result);
        } catch (err) {
            console.error('POST /api/patients error:', err);
            return res.status(500).json({ error: 'Failed to save patient' });
        }
    },
);

// POST /api/patients/:id/diagnoses — create a new diagnosis for an existing patient
router.post(
    '/:id/diagnoses',
    authenticate,
    requireFreshAccessToken,
    async (req: AuthRequest, res: Response) => {
        const parsed = createDiagnosisSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
        }

        const userId = req.userRecord!.id;
        const userEmail = req.userRecord!.email ?? null;
        const sourceIp = (req.ip ?? req.socket.remoteAddress) ?? null;
        const userAgent = req.headers['user-agent'] ?? null;

        try {
            const patient = await getPatientById(req.params.id, userId);
            if (!patient) {
                return res.status(404).json({ error: 'Not found' });
            }

            const {
                historiaClinica,
                symptomsExtracted,
                phenotypes,
                genphenGenes,
                genphenSpecialties,
                genphenConfidence,
            } = parsed.data;

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
                sourceIp,
                userAgent,
            );

            return res.status(201).json(result);
        } catch (err) {
            console.error('POST /api/patients/:id/diagnoses error:', err);
            return res.status(500).json({ error: 'Failed to save diagnosis' });
        }
    },
);

// GET /api/patients — list all patients for authenticated user
router.get(
    '/',
    authenticate,
    requireFreshAccessToken,
    async (req: AuthRequest, res: Response) => {
        try {
            const patients = await getPatientsByUser(req.userRecord!.id);
            return res.json(patients);
        } catch (err) {
            console.error('GET /api/patients error:', err);
            return res.status(500).json({ error: 'Failed to fetch patients' });
        }
    },
);

// GET /api/patients/:id — single patient (ownership enforced)
router.get(
    '/:id',
    authenticate,
    requireFreshAccessToken,
    async (req: AuthRequest, res: Response) => {
        try {
            const patient = await getPatientById(req.params.id, req.userRecord!.id);
            if (!patient) return res.status(404).json({ error: 'Not found' });
            return res.json(patient);
        } catch (err) {
            console.error('GET /api/patients/:id error:', err);
            return res.status(500).json({ error: 'Failed to fetch patient' });
        }
    },
);

// DELETE /api/patients/:id — delete patient and all diagnoses (cascade)
router.delete(
    '/:id',
    authenticate,
    requireFreshAccessToken,
    async (req: AuthRequest, res: Response) => {
        try {
            const deleted = await deletePatient(req.params.id, req.userRecord!.id);
            if (!deleted) return res.status(404).json({ error: 'Not found' });
            return res.status(204).send();
        } catch (err) {
            console.error('DELETE /api/patients/:id error:', err);
            return res.status(500).json({ error: 'Failed to delete patient' });
        }
    },
);

// GET /api/patients/:id/diagnoses — list diagnoses for a patient
router.get(
    '/:id/diagnoses',
    authenticate,
    requireFreshAccessToken,
    async (req: AuthRequest, res: Response) => {
        // Verify patient ownership first
        let patient;
        try {
            patient = await getPatientById(req.params.id, req.userRecord!.id);
        } catch (err) {
            console.error('GET /api/patients/:id/diagnoses ownership check error:', err);
            return res.status(500).json({ error: 'Failed to fetch diagnoses' });
        }
        if (!patient) return res.status(404).json({ error: 'Not found' });

        try {
            const diagnoses = await getDiagnosesByPatient(req.params.id, req.userRecord!.id);
            return res.json(diagnoses);
        } catch (err) {
            console.error('GET /api/patients/:id/diagnoses error:', err);
            return res.status(500).json({ error: 'Failed to fetch diagnoses' });
        }
    },
);

// GET /api/patients/:id/diagnoses/:diagId — single diagnosis (full data)
router.get(
    '/:id/diagnoses/:diagId',
    authenticate,
    requireFreshAccessToken,
    async (req: AuthRequest, res: Response) => {
        try {
            const diagnosis = await getDiagnosisById(req.params.diagId, req.userRecord!.id);
            if (!diagnosis || diagnosis.patient_id !== req.params.id) {
                return res.status(404).json({ error: 'Not found' });
            }
            return res.json(diagnosis);
        } catch (err) {
            console.error('GET /api/patients/:id/diagnoses/:diagId error:', err);
            return res.status(500).json({ error: 'Failed to fetch diagnosis' });
        }
    },
);

export default router;
