import { DatabaseSync } from 'node:sqlite';
import { GENE_PROFILES_DB_PATH } from '../config.js';

/**
 * Gene profiles: Spanish descriptions of the genes GenPhenAI ranks.
 *
 * The data is a read-only SQLite file built outside this repository and copied
 * to the node, not a Postgres table — it is public reference data from NCBI,
 * UniProt and OMIM, rebuilt wholesale rather than migrated.
 *
 * Two audiences share one source. The default shape is what a family sees; the
 * technical columns are only read when `professional` is set, which the caller
 * decides server-side. Nothing here is patient data.
 */

export interface Disease {
    nombre: string;
    descripcion_es: string;
    omim: string;
}

export interface Symptom {
    hpo_id: string;
    nombre: string;
    frecuencia_pct: number | null;
    frecuencia_texto: string | null;
}

export interface GeneProfile {
    simbolo: string;
    nombre_completo: string | null;
    cromosoma: string | null;
    ubicacion: string | null;
    /** The curated Spanish summary. Technical, and the default the card shows. */
    resumen_es: string | null;
    /** Plain-language rewrite. Generated, unreviewed, and not shown yet. */
    resumen_llano_es: string | null;
    enfermedades: Disease[];
    coincidencias: Symptom[];
    frecuentes_no_reportados: Symptom[];
    total_esperados: number;
    referencias: Record<string, string>;
    tecnico?: {
        resumen_es: string | null;
        funcion_proteina_es: string | null;
        resumen_en: string | null;
        funcion_proteina_en: string | null;
        aliases: string | null;
        ncbi_id: string | null;
        uniprot_accession: string | null;
        codigo_omim: string[];
    };
}

interface GeneRow {
    simbolo: string;
    nombre_completo: string | null;
    cromosoma: string | null;
    ubicacion: string | null;
    aliases: string | null;
    enfermedades_es: string | null;
    resumen_llano_es: string | null;
    tecnico_resumen_es: string | null;
    tecnico_funcion_es: string | null;
    tecnico_resumen_en: string | null;
    tecnico_funcion_en: string | null;
    ncbi_id: string | null;
    uniprot_accession: string | null;
    codigo_omim: string | null;
    referencias: string | null;
}

interface SymptomRow {
    hpo_id: string;
    label_es: string | null;
    label_en: string | null;
    frecuencia_pct: number | null;
    frecuencia_es: string | null;
    frecuencia_raw: string | null;
}

const MAX_UNREPORTED = 5;

let db: DatabaseSync | null = null;
let unavailableReason: string | null = null;

function connect(): DatabaseSync | null {
    if (db) return db;
    if (unavailableReason) return null;

    try {
        db = new DatabaseSync(GENE_PROFILES_DB_PATH, { readOnly: true });
        return db;
    } catch (error) {
        // The file is optional: the platform must keep working without it,
        // showing genes with no description rather than failing the request.
        unavailableReason = error instanceof Error ? error.message : String(error);
        console.warn(
            `[gene-profiles] unavailable at ${GENE_PROFILES_DB_PATH}: ${unavailableReason}. ` +
            'Gene results will render without descriptions. If the path is a ' +
            'directory, Docker created it for a bind mount whose source file ' +
            'does not exist — copy the database there or unset GENE_PROFILES_DB.',
        );
        return null;
    }
}

export function isAvailable(): boolean {
    return connect() !== null;
}

export function buildInfo(): Record<string, string> {
    const conn = connect();
    if (!conn) return {};
    const rows = conn.prepare('SELECT clave, valor FROM build_info').all() as unknown as
        { clave: string; valor: string }[];
    return Object.fromEntries(rows.map((r) => [r.clave, r.valor]));
}

function parseJson<T>(raw: string | null, fallback: T): T {
    if (!raw) return fallback;
    try {
        return JSON.parse(raw) as T;
    } catch {
        return fallback;
    }
}

function toSymptom(row: SymptomRow): Symptom {
    return {
        hpo_id: row.hpo_id,
        nombre: row.label_es || row.label_en || row.hpo_id,
        frecuencia_pct: row.frecuencia_pct,
        frecuencia_texto: row.frecuencia_es || row.frecuencia_raw,
    };
}

/**
 * One gene's profile, or null when the gene has no entry.
 *
 * A miss is expected rather than exceptional: the HPO release the model ranks
 * over can move ahead of the release the database was built from. Callers must
 * render the gene without a description — never hide it, never invent one.
 *
 * `reportedHpoIds` are the phenotypes the patient described. Comparing them
 * with the phenotypes reported for this gene's diseases is what turns a bare
 * symbol into something a person can act on. This is our own computation:
 * `/rank-genes` never says why it ranked a gene.
 */
export function getGeneProfile(
    symbol: string,
    reportedHpoIds: string[] = [],
    options: { professional?: boolean } = {},
): GeneProfile | null {
    const conn = connect();
    if (!conn) return null;

    const row = conn
        .prepare('SELECT * FROM genes WHERE simbolo = ?')
        .get(symbol.trim().toUpperCase()) as unknown as GeneRow | undefined;
    if (!row) return null;

    const omimCodes = parseJson<string[]>(row.codigo_omim, []);

    let symptomRows: SymptomRow[] = [];
    if (omimCodes.length > 0) {
        const placeholders = omimCodes.map(() => '?').join(',');
        // A phenotype can appear under several of a gene's diseases; keep the
        // highest reported frequency so a symptom is never understated.
        symptomRows = conn
            .prepare(
                `SELECT hpo_id, label_es, label_en, frecuencia_es, frecuencia_raw,
                        MAX(COALESCE(frecuencia_pct, -1)) AS frecuencia_pct
                 FROM sintomas_esperados WHERE omim IN (${placeholders})
                 GROUP BY hpo_id ORDER BY frecuencia_pct DESC`,
            )
            .all(...omimCodes) as unknown as SymptomRow[];
    }

    const reported = new Set(reportedHpoIds.map((id) => id.trim().toUpperCase()));
    const coincidencias: Symptom[] = [];
    const noReportados: Symptom[] = [];

    for (const symptomRow of symptomRows) {
        const symptom = toSymptom(symptomRow);
        if (symptom.frecuencia_pct !== null && symptom.frecuencia_pct < 0) {
            symptom.frecuencia_pct = null;
        }
        if (reported.has(symptomRow.hpo_id.toUpperCase())) {
            coincidencias.push(symptom);
        } else if (symptom.frecuencia_pct !== null) {
            noReportados.push(symptom);
        }
    }

    const profile: GeneProfile = {
        simbolo: row.simbolo,
        nombre_completo: row.nombre_completo,
        cromosoma: row.cromosoma,
        ubicacion: row.ubicacion,
        resumen_es: row.tecnico_resumen_es,
        resumen_llano_es: row.resumen_llano_es,
        enfermedades: parseJson<Disease[]>(row.enfermedades_es, []),
        coincidencias,
        frecuentes_no_reportados: noReportados.slice(0, MAX_UNREPORTED),
        total_esperados: symptomRows.length,
        referencias: parseJson<Record<string, string>>(row.referencias, {}),
    };

    if (options.professional) {
        profile.tecnico = {
            resumen_es: row.tecnico_resumen_es,
            funcion_proteina_es: row.tecnico_funcion_es,
            resumen_en: row.tecnico_resumen_en,
            funcion_proteina_en: row.tecnico_funcion_en,
            aliases: row.aliases,
            ncbi_id: row.ncbi_id,
            uniprot_accession: row.uniprot_accession,
            codigo_omim: omimCodes,
        };
    }

    return profile;
}
