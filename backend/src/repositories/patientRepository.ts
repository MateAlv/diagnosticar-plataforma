import { query, getClient } from '../database/pool.js';

export type Patient = {
    id: string;
    user_id: string;
    user_email_snapshot: string | null;
    nombre: string;
    fecha_nacimiento: string | null;
    sexo: string | null;
    localidad: string | null;
    pais: string | null;
    created_at: string;
    updated_at: string;
};

export type PatientWithLatestDiagnosis = Patient & {
    latest_diagnosis: {
        id: string;
        genphen_confidence: number | null;
        genphen_specialties: any | null;
        genphen_genes_top5: any[];
        created_at: string;
    } | null;
};

export type DiagnosisInput = {
    historiaClinica: string;
    symptomsExtracted: any[];
    phenotypes: any[];
    genphenGenes: any[];
    genphenSpecialties?: any;
    genphenConfidence?: number | null;
};

export type PatientInput = {
    nombre: string;
    fechaNacimiento?: string | null;
    sexo?: string | null;
    localidad?: string | null;
    pais?: string | null;
};

/**
 * Creates a patient and their first diagnosis in a single transaction.
 * Ownership is guaranteed: patient.user_id = userId.
 */
export async function createPatientWithDiagnosis(
    userId: string,
    userEmailSnapshot: string | null,
    patientData: PatientInput,
    diagnosisData: DiagnosisInput,
    sourceIp: string | null,
    userAgent: string | null,
): Promise<{ patient: Patient; diagnosisId: string }> {
    const client = await getClient();
    try {
        await client.query('BEGIN');

        const patientRes = await client.query<Patient>(
            `INSERT INTO patients
               (user_id, user_email_snapshot, nombre, fecha_nacimiento, sexo, localidad, pais)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [
                userId,
                userEmailSnapshot,
                patientData.nombre,
                patientData.fechaNacimiento ?? null,
                patientData.sexo ?? null,
                patientData.localidad ?? null,
                patientData.pais ?? null,
            ],
        );
        const patient = patientRes.rows[0];

        const diagRes = await client.query<{ id: string }>(
            `INSERT INTO diagnoses
               (patient_id, user_id, user_email_snapshot, historia_clinica,
                symptoms_extracted, phenotypes, genphen_genes,
                genphen_specialties, genphen_confidence, source_ip, user_agent)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             RETURNING id`,
            [
                patient.id,
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

        await client.query('COMMIT');
        return { patient, diagnosisId: diagRes.rows[0].id };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Returns all patients for a user, each with a summary of their latest diagnosis.
 * Uses a single query with a lateral subquery — no N+1.
 */
export async function getPatientsByUser(userId: string): Promise<PatientWithLatestDiagnosis[]> {
    const res = await query(
        `SELECT
           p.*,
           ld.id            AS diag_id,
           ld.genphen_confidence,
           ld.genphen_specialties,
           ld.genphen_genes,
           ld.created_at    AS diag_created_at
         FROM patients p
         LEFT JOIN LATERAL (
           SELECT id, genphen_confidence, genphen_specialties, genphen_genes, created_at
           FROM diagnoses d
           WHERE d.patient_id = p.id
           ORDER BY d.created_at DESC
           LIMIT 1
         ) ld ON true
         WHERE p.user_id = $1
         ORDER BY COALESCE(ld.created_at, p.created_at) DESC`,
        [userId],
    );

    return res.rows.map((row) => {
        const genes: any[] = row.genphen_genes ?? [];
        const latestDiag = row.diag_id
            ? {
                  id: row.diag_id,
                  genphen_confidence: row.genphen_confidence,
                  genphen_specialties: row.genphen_specialties,
                  genphen_genes_top5: genes.slice(0, 5),
                  created_at: row.diag_created_at,
              }
            : null;

        return {
            id: row.id,
            user_id: row.user_id,
            user_email_snapshot: row.user_email_snapshot,
            nombre: row.nombre,
            fecha_nacimiento: row.fecha_nacimiento,
            sexo: row.sexo,
            localidad: row.localidad,
            pais: row.pais,
            created_at: row.created_at,
            updated_at: row.updated_at,
            latest_diagnosis: latestDiag,
        };
    });
}

/**
 * Returns a single patient, only if it belongs to userId.
 */
export async function getPatientById(id: string, userId: string): Promise<Patient | null> {
    const res = await query(
        'SELECT * FROM patients WHERE id = $1 AND user_id = $2',
        [id, userId],
    );
    return res.rows[0] ?? null;
}

/**
 * Deletes a patient and all their diagnoses (cascaded by FK).
 * Returns true if a row was deleted, false if not found / not owned.
 */
export async function deletePatient(id: string, userId: string): Promise<boolean> {
    const res = await query(
        'DELETE FROM patients WHERE id = $1 AND user_id = $2',
        [id, userId],
    );
    return (res.rowCount ?? 0) > 0;
}
