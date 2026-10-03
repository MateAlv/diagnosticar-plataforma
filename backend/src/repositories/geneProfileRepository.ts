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
    /**
     * How many of the patient's reported phenotypes this particular condition
     * accounts for. Lets a caller name the condition that is actually relevant
     * instead of whichever happened to sort first — a gene's conditions arrive
     * in no meaningful order, and 1,293 genes carry more than one.
     *
     * Never a ranking of likelihood, and never reordered on screen: the model
     * predicts genes, not diseases, and a sorted list of conditions would read
     * as a differential it did not produce.
     */
    coincidencias?: number;
}

export interface Symptom {
    hpo_id: string;
    nombre: string;
    frecuencia_pct: number | null;
    frecuencia_texto: string | null;
    /**
     * Set when this symptom matched something the patient reported *more
     * generally* — they said "fiebre", the disease is annotated with "fiebre
     * episódica". Absent on an exact match.
     *
     * Worth surfacing rather than hiding: that the condition causes a more
     * specific form of what they described is itself information.
     */
    coincide_con?: { hpo_id: string; distancia: number };
}

/**
 * One thing the patient reported, and how this gene's annotations meet it.
 *
 * Grouped rather than flat because a single reported term can subsume many
 * annotated ones: "convulsiones" reaches six of ARX's, and listing all six
 * made one thing the family said look like six pieces of evidence.
 *
 * `exacta` is the annotation that *is* the reported term. `especificas` are
 * the ones beneath it — real, but weaker: they are our inference from the
 * ontology, not something the family reported. Several are also more severe
 * than what was described ("retraso global profundo del desarrollo" under a
 * reported "retraso del desarrollo"), so a caller must not present them as
 * findings about this patient.
 */
export interface MatchedReport {
    /** The HPO id the patient's own words were mapped to. */
    reportado_hpo_id: string;
    exacta: Symptom | null;
    especificas: Symptom[];
}

export interface GeneProfile {
    simbolo: string;
    nombre_completo: string | null;
    cromosoma: string | null;
    ubicacion: string | null;
    /**
     * The gene's own OMIM entry (TCF4 → 602272), not one of its diseases.
     * Null for the few genes OMIM has no entry for, and on a database built
     * before the column existed.
     */
    omim_gen: string | null;
    /** The curated Spanish summary. Technical, and the default the card shows. */
    resumen_es: string | null;
    /** Plain-language rewrite. Generated, unreviewed, and not shown yet. */
    resumen_llano_es: string | null;
    enfermedades: Disease[];
    /** Flat list, kept for callers that only need the count. */
    coincidencias: Symptom[];
    /** The same matches, grouped by the reported term each one answers. */
    coincidencias_por_reporte: MatchedReport[];
    frecuentes_no_reportados: Symptom[];
    total_esperados: number;
    /**
     * Which of the *reported* phenotypes this gene engages at all, as HPO ids.
     *
     * Not the same as `coincidencias.length`, and the difference matters on
     * screen: a gene can match nine annotated symptoms that all trace back to
     * one thing the family said. "9 coincidencias" would overstate that;
     * "1 de 4 cosas que contaste" is what actually happened, and the
     * denominator is the reader's own report, so they can check it.
     */
    reportados_cubiertos: string[];
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
    omim_gen?: string | null;
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
 * Whether this database carries the ancestor closure.
 *
 * The file is copied to the node by hand, so one built before the graph
 * existed can be mounted at any time; it must degrade to exact matching rather
 * than failing every request. Cached because the answer cannot change while
 * the connection is open, and the results screen asks once per ranked gene.
 */
let ancestorTable: boolean | null = null;

function hasAncestorTable(conn: DatabaseSync): boolean {
    if (ancestorTable === null) {
        ancestorTable = Boolean(
            conn
                .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'hpo_ancestros'")
                .get(),
        );
        if (!ancestorTable) {
            console.warn(
                '[gene-profiles] no hpo_ancestros table; phenotypes will only match ' +
                'exactly, so most genes will show no overlap. Rebuild the database or ' +
                'run scripts/add_hpo_graph.py against it.',
            );
        }
    }
    return ancestorTable;
}

/**
 * Which of this gene's expected symptoms sit *underneath* something the patient
 * reported, in HPO's is_a graph.
 *
 * Families describe symptoms in general language — the extractor returns
 * "Convulsiones", "Fiebre" — while diseases are annotated with specific terms
 * like "Espasmos infantiles" and "Fiebre episódica". Comparing ids exactly
 * therefore matches almost nothing, and every gene reads "sin coincidencias"
 * even when the overlap is real.
 *
 * Only this direction counts. The patient reporting a general finding and the
 * disease causing a specific form of it is a genuine overlap; the reverse,
 * claiming a match on "Convulsiones" because they reported "Espasmos
 * infantiles", would dress a weaker relationship up as the same thing.
 *
 * The closure is bounded at build time (`hpo_ancestros`, 3 hops), so a walk
 * cannot reach "Phenotypic abnormality" and make every gene match everything.
 *
 * Returns hpo_id -> the reported term it matched and how many hops away.
 */
function findSubsumed(
    conn: DatabaseSync,
    symptomRows: SymptomRow[],
    reported: Set<string>,
): Map<string, { hpo_id: string; distancia: number }> {
    const out = new Map<string, { hpo_id: string; distancia: number }>();
    if (reported.size === 0 || symptomRows.length === 0) return out;

    if (!hasAncestorTable(conn)) return out;

    const ids = symptomRows.map((row) => row.hpo_id.toUpperCase());
    const ancestors = [...reported];
    const rows = conn
        .prepare(
            `SELECT hpo_id, ancestro_id, distancia FROM hpo_ancestros
             WHERE hpo_id IN (${ids.map(() => '?').join(',')})
               AND ancestro_id IN (${ancestors.map(() => '?').join(',')})
             ORDER BY distancia`,
        )
        .all(...ids, ...ancestors) as unknown as {
        hpo_id: string;
        ancestro_id: string;
        distancia: number;
    }[];

    // Ordered by distance, so the first hit for a term is its closest reported
    // ancestor — the most specific thing the patient actually said.
    for (const row of rows) {
        const key = row.hpo_id.toUpperCase();
        if (!out.has(key)) {
            out.set(key, { hpo_id: row.ancestro_id, distancia: row.distancia });
        }
    }
    return out;
}

/**
 * Fold the flat match list into one entry per reported term.
 *
 * Ordered by how much of the reported term each entry accounts for — an exact
 * match first, then the ones carrying the most specific variants — so the
 * strongest evidence leads.
 */
function groupByReport(matches: Symptom[]): MatchedReport[] {
    const byReport = new Map<string, MatchedReport>();

    for (const symptom of matches) {
        const reportedId = (symptom.coincide_con?.hpo_id ?? symptom.hpo_id).toUpperCase();
        let entry = byReport.get(reportedId);
        if (!entry) {
            entry = { reportado_hpo_id: reportedId, exacta: null, especificas: [] };
            byReport.set(reportedId, entry);
        }
        if (symptom.coincide_con) {
            entry.especificas.push(symptom);
        } else {
            entry.exacta = symptom;
        }
    }

    return [...byReport.values()].sort((a, b) => {
        if (Boolean(a.exacta) !== Boolean(b.exacta)) return a.exacta ? -1 : 1;
        return b.especificas.length - a.especificas.length;
    });
}

/**
 * Count, per condition, how many reported phenotypes it accounts for.
 *
 * The results screen has to name one condition next to a gene, and it was
 * showing `enfermedades[0]` — the first of an unordered list. For the 1,293
 * genes carrying more than one, that is an arbitrary pick, and an arbitrary
 * pick is misleading precisely because it reads as the answer.
 *
 * The order of `enfermedades` is left alone. A caller that wants the relevant
 * one reads the counts; sorting them here would turn labelled context into
 * something that looks like a ranked differential.
 */
function annotateDiseases(
    conn: DatabaseSync,
    diseases: Disease[],
    reported: Set<string>,
    subsumed: Map<string, { hpo_id: string; distancia: number }>,
): Disease[] {
    if (diseases.length === 0 || reported.size === 0) return diseases;

    const codes = diseases.map((disease) => disease.omim).filter(Boolean);
    if (codes.length === 0) return diseases;

    const rows = conn
        .prepare(
            `SELECT omim, hpo_id FROM sintomas_esperados
             WHERE omim IN (${codes.map(() => '?').join(',')})`,
        )
        .all(...codes) as unknown as { omim: string; hpo_id: string }[];

    const counts = new Map<string, number>();
    for (const row of rows) {
        const hpoId = row.hpo_id.toUpperCase();
        // Same rule as the symptom list, so the two numbers cannot disagree.
        if (reported.has(hpoId) || subsumed.has(hpoId)) {
            counts.set(row.omim, (counts.get(row.omim) ?? 0) + 1);
        }
    }

    return diseases.map((disease) => ({
        ...disease,
        coincidencias: counts.get(disease.omim) ?? 0,
    }));
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
    const subsumed = findSubsumed(conn, symptomRows, reported);
    const coincidencias: Symptom[] = [];
    const noReportados: Symptom[] = [];

    for (const symptomRow of symptomRows) {
        const symptom = toSymptom(symptomRow);
        if (symptom.frecuencia_pct !== null && symptom.frecuencia_pct < 0) {
            symptom.frecuencia_pct = null;
        }
        const hpoId = symptomRow.hpo_id.toUpperCase();
        const via = subsumed.get(hpoId);
        if (reported.has(hpoId)) {
            coincidencias.push(symptom);
        } else if (via) {
            symptom.coincide_con = via;
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
        omim_gen: row.omim_gen ?? null,
        resumen_es: row.tecnico_resumen_es,
        resumen_llano_es: row.resumen_llano_es,
        enfermedades: annotateDiseases(
            conn,
            parseJson<Disease[]>(row.enfermedades_es, []),
            reported,
            subsumed,
        ),
        coincidencias,
        frecuentes_no_reportados: noReportados.slice(0, MAX_UNREPORTED),
        coincidencias_por_reporte: groupByReport(coincidencias),
        total_esperados: symptomRows.length,
        reportados_cubiertos: [
            ...new Set(
                coincidencias.map(
                    (symptom) => symptom.coincide_con?.hpo_id ?? symptom.hpo_id.toUpperCase(),
                ),
            ),
        ],
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

// --- The HPO tree, for refining a general term --------------------------------

/**
 * An HPO term as the "too general" dialog shows it.
 *
 * `genes` is how many genes the term reaches: genes with a disease annotated
 * with it or with anything beneath it. The fewer, the more the term narrows the
 * ranking, which is what makes a child worth offering over its parent.
 * `tiene_hijos` says whether anything beneath it reaches a gene, so the dialog
 * only offers to go deeper where there is something to find. `hijos` and
 * `debajo` count the terms directly and anywhere beneath it that reach a gene:
 * how far up the tree it sits, which is what decides whether the wizard offers
 * to refine it (docs/PRECISAR_SINTOMAS.md).
 */
export interface TermSummary {
    hpo_id: string;
    nombre: string;
    genes: number;
    tiene_hijos: boolean;
    hijos: number;
    debajo: number;
}

export interface TermChildren {
    termino: TermSummary | null;
    hijos: TermSummary[];
}

let termTree: boolean | null = null;

/** Whether this database carries the tree; one built before it cannot. */
function hasTermTree(conn: DatabaseSync): boolean {
    if (termTree === null) {
        const found = conn
            .prepare(
                "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' " +
                "AND name IN ('hpo_terminos', 'hpo_hijos', 'termino_cobertura')",
            )
            .get() as { n: number } | undefined;
        termTree = found?.n === 3;
        if (!termTree) {
            console.warn(
                '[gene-profiles] no HPO term tree; the wizard will not flag general ' +
                'symptoms. Run scripts/add_term_tree.py against the database.',
            );
        }
    }
    return termTree;
}

const TERM_COLUMNS = `
    t.hpo_id AS hpo_id,
    t.nombre AS nombre,
    COALESCE(c.genes, 0) AS genes,
    EXISTS (
        SELECT 1 FROM hpo_hijos h
        JOIN termino_cobertura hc ON hc.hpo_id = h.hijo
        WHERE h.padre = t.hpo_id
    ) AS tiene_hijos`;

interface TermRow {
    hpo_id: string;
    nombre: string;
    genes: number;
    tiene_hijos: number;
}

let subtrees: Map<string, { hijos: number; debajo: number }> | null = null;

/**
 * For every term, how many terms that reach a gene sit directly and anywhere
 * beneath it. Computed once from the ~24,000 edges; a term reached by two
 * paths counts once.
 */
function subtreeSizes(conn: DatabaseSync): Map<string, { hijos: number; debajo: number }> {
    if (subtrees) return subtrees;
    const edges = conn
        .prepare(
            `SELECT h.padre AS padre, h.hijo AS hijo FROM hpo_hijos h
             JOIN termino_cobertura c ON c.hpo_id = h.hijo AND c.genes > 0`,
        )
        .all() as unknown as { padre: string; hijo: string }[];
    const children = new Map<string, string[]>();
    for (const { padre, hijo } of edges) {
        const list = children.get(padre);
        if (list) list.push(hijo);
        else children.set(padre, [hijo]);
    }
    const below = new Map<string, Set<string>>();
    const collect = (id: string): Set<string> => {
        const known = below.get(id);
        if (known) return known;
        const found = new Set<string>();
        below.set(id, found);
        for (const child of children.get(id) ?? []) {
            found.add(child);
            for (const deeper of collect(child)) found.add(deeper);
        }
        return found;
    };
    subtrees = new Map();
    for (const id of children.keys()) {
        subtrees.set(id, { hijos: new Set(children.get(id)).size, debajo: collect(id).size });
    }
    return subtrees;
}

function toTerm(row: TermRow, sizes: Map<string, { hijos: number; debajo: number }>): TermSummary {
    const size = sizes.get(row.hpo_id);
    return {
        hpo_id: row.hpo_id,
        nombre: row.nombre,
        genes: row.genes,
        tiene_hijos: Boolean(row.tiene_hijos),
        hijos: size?.hijos ?? 0,
        debajo: size?.debajo ?? 0,
    };
}

/** The given terms, in the order asked; unknown ids are left out. */
export function getTerms(hpoIds: string[]): TermSummary[] {
    const conn = connect();
    if (!conn || hpoIds.length === 0 || !hasTermTree(conn)) return [];
    const ids = [...new Set(hpoIds.map((id) => id.toUpperCase()))];
    const rows = conn
        .prepare(
            `SELECT ${TERM_COLUMNS}
             FROM hpo_terminos t LEFT JOIN termino_cobertura c ON c.hpo_id = t.hpo_id
             WHERE t.hpo_id IN (${ids.map(() => '?').join(',')})`,
        )
        .all(...ids) as unknown as TermRow[];
    const sizes = subtreeSizes(conn);
    const byId = new Map(rows.map((row) => [row.hpo_id, toTerm(row, sizes)]));
    return ids.flatMap((id) => byId.get(id) ?? []);
}

/**
 * A term and the terms directly beneath it that reach at least one gene, the
 * ones reaching most genes first, so the common forms lead and the rare ones
 * trail. A child that reaches no gene is left out: choosing it would give the
 * model a term it knows nothing about.
 */
export function getTermChildren(hpoId: string): TermChildren {
    const conn = connect();
    if (!conn || !hasTermTree(conn)) return { termino: null, hijos: [] };
    const id = hpoId.toUpperCase();
    const termino = getTerms([id])[0] ?? null;
    if (!termino) return { termino: null, hijos: [] };
    const hijos = conn
        .prepare(
            `SELECT ${TERM_COLUMNS}
             FROM hpo_hijos h
             JOIN hpo_terminos t ON t.hpo_id = h.hijo
             JOIN termino_cobertura c ON c.hpo_id = h.hijo
             WHERE h.padre = ?
             ORDER BY c.genes DESC, t.nombre`,
        )
        .all(id) as unknown as TermRow[];
    const sizes = subtreeSizes(conn);
    return { termino, hijos: hijos.map((row) => toTerm(row, sizes)) };
}
