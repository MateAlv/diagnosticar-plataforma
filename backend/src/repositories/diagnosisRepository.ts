import { query } from '../database/pool.js';

export type Diagnosis = {
    id: string;
    patient_id: string;
    user_id: string;
    user_email_snapshot: string | null;
    historia_clinica: string;
    symptoms_extracted: any[];
    phenotypes: any[];
    genphen_genes: any[];
    genphen_specialties: any | null;
    genphen_confidence: number | null;
    source_ip: string | null;
    user_agent: string | null;
    created_at: string;
};

export type DiagnosisInput = {
    historiaClinica: string;
    symptomsExtracted: any[];
    phenotypes: any[];
    genphenGenes: any[];
    genphenSpecialties?: any;
    genphenConfidence?: number | null;
};

export async function createDiagnosisForPatient(
    patientId: string,
    userId: string,
    userEmailSnapshot: string | null,
    diagnosisData: DiagnosisInput,
    sourceIp: string | null,
    userAgent: string | null,
): Promise<{ diagnosisId: string }> {
    const res = await query(
        `INSERT INTO diagnoses
           (patient_id, user_id, user_email_snapshot, historia_clinica,
            symptoms_extracted, phenotypes, genphen_genes,
            genphen_specialties, genphen_confidence, source_ip, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id`,
        [
            patientId,
            userId,
            userEmailSnapshot,
            diagnosisData.historiaClinica,
            JSON.stringify(diagnosisData.symptomsExtracted),
            JSON.stringify(diagnosisData.phenotypes),
            JSON.stringify(diagnosisData.genphenGenes),
            diagnosisData.genphenSpecialties ? JSON.stringify(diagnosisData.genphenSpecialties) : null,
            diagnosisData.genphenConfidence ?? null,
            sourceIp,
            userAgent,
        ],
    );

    const inserted = res.rows[0] as { id: string } | undefined;
    if (!inserted?.id) {
        throw new Error('Failed to create diagnosis');
    }

    return { diagnosisId: inserted.id };
}

/**
 * The columns a diagnosis is read with, listed rather than `d.*`.
 * `preguntas_respuestas` is left out on purpose: it holds the question agent's
 * raw responses, versions included, and /api/questions is the only way to read
 * a session, in the shape the browser is meant to see.
 */
const DIAGNOSIS_COLUMNS = `d.id, d.patient_id, d.user_id, d.user_email_snapshot, d.historia_clinica,
    d.symptoms_extracted, d.phenotypes, d.genphen_genes, d.genphen_specialties,
    d.genphen_confidence, d.source_ip, d.user_agent, d.created_at`;

/**
 * Returns all diagnoses for a patient, only if the patient belongs to userId.
 */
export async function getDiagnosesByPatient(patientId: string, userId: string): Promise<Diagnosis[]> {
    const res = await query(
        `SELECT ${DIAGNOSIS_COLUMNS}
         FROM diagnoses d
         JOIN patients p ON p.id = d.patient_id
         WHERE d.patient_id = $1 AND p.user_id = $2
         ORDER BY d.created_at DESC`,
        [patientId, userId],
    );
    return res.rows;
}

/**
 * Returns a single diagnosis, only if the patient it belongs to is owned by userId.
 */
export async function getDiagnosisById(id: string, userId: string): Promise<Diagnosis | null> {
    const res = await query(
        `SELECT ${DIAGNOSIS_COLUMNS}
         FROM diagnoses d
         WHERE d.id = $1 AND d.user_id = $2`,
        [id, userId],
    );
    return res.rows[0] ?? null;
}

export type QuestionContext = {
    symptoms_extracted: unknown;
    phenotypes: unknown;
    preguntas_respuestas: unknown;
};

/**
 * Only the columns the question agent needs, and only for the owner: the
 * clinical history itself is never read on this path.
 */
export async function getQuestionContext(id: string, userId: string): Promise<QuestionContext | null> {
    const res = await query(
        `SELECT symptoms_extracted, phenotypes, preguntas_respuestas
         FROM diagnoses
         WHERE id = $1 AND user_id = $2`,
        [id, userId],
    );
    return res.rows[0] ?? null;
}

export type SaveSessionOutcome = 'saved' | 'missing' | 'conflict';

/**
 * Compare-and-set: writes `session` only if the column still holds `previous`,
 * the raw value the caller read. The per-account lock in routes/questions.ts
 * is per process, so this is what stops two writers from overwriting each
 * other's rounds.
 */
export async function saveQuestionSession(
    id: string,
    userId: string,
    session: unknown,
    previous: unknown,
): Promise<SaveSessionOutcome> {
    const res = await query(
        `UPDATE diagnoses
         SET preguntas_respuestas = $3::jsonb
         WHERE id = $1 AND user_id = $2
           AND preguntas_respuestas IS NOT DISTINCT FROM $4::jsonb`,
        [id, userId, JSON.stringify(session), previous == null ? null : JSON.stringify(previous)],
    );
    if ((res.rowCount ?? 0) > 0) return 'saved';

    const still = await query('SELECT 1 FROM diagnoses WHERE id = $1 AND user_id = $2', [id, userId]);
    return (still.rowCount ?? 0) > 0 ? 'conflict' : 'missing';
}
