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
    const res = await query<{ id: string }>(
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

    return { diagnosisId: res.rows[0].id };
}

/**
 * Returns all diagnoses for a patient, only if the patient belongs to userId.
 */
export async function getDiagnosesByPatient(patientId: string, userId: string): Promise<Diagnosis[]> {
    const res = await query(
        `SELECT d.*
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
        `SELECT d.*
         FROM diagnoses d
         WHERE d.id = $1 AND d.user_id = $2`,
        [id, userId],
    );
    return res.rows[0] ?? null;
}
