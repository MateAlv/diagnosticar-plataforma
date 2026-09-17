import { query } from '../database/pool.js';

/**
 * Aggregate-only reads for the backoffice.
 *
 * Every function here returns counts and averages. None returns a row from
 * `patients` or `diagnoses`, and none selects `historia_clinica`, `nombre`,
 * `fecha_nacimiento`, `source_ip` or `user_agent`. The aggregation happens in
 * SQL rather than in the route so that clinical data never leaves the database
 * in the first place — a bug in the admin UI cannot leak what was never
 * fetched.
 *
 * `MIN_CELL` suppresses small buckets. In a rare-disease platform a bucket of
 * one is potentially a named family, which is why geography is reported by
 * country and never by `localidad`.
 */
const MIN_CELL = 5;

export type TimePoint = { day: string; count: number };
export type Bucket = { label: string; count: number };

export async function getTotals() {
    const { rows } = await query(`
        SELECT
          (SELECT count(*) FROM users)                                   AS users,
          (SELECT count(*) FROM users WHERE created_at > now() - interval '30 days') AS users_30d,
          (SELECT count(*) FROM users WHERE last_login_at > now() - interval '30 days') AS active_30d,
          (SELECT count(*) FROM patients)                                AS patients,
          (SELECT count(*) FROM diagnoses)                               AS diagnoses,
          (SELECT count(*) FROM diagnoses WHERE created_at > now() - interval '30 days') AS diagnoses_30d,
          (SELECT count(*) FROM diagnoses WHERE created_at > now() - interval '24 hours') AS diagnoses_24h
    `);
    const r = rows[0] ?? {};
    return {
        users: Number(r.users ?? 0),
        usersLast30d: Number(r.users_30d ?? 0),
        activeLast30d: Number(r.active_30d ?? 0),
        patients: Number(r.patients ?? 0),
        diagnoses: Number(r.diagnoses ?? 0),
        diagnosesLast30d: Number(r.diagnoses_30d ?? 0),
        diagnosesLast24h: Number(r.diagnoses_24h ?? 0),
    };
}

/** Daily submission counts. `days` is clamped by the caller. */
export async function getDiagnosesPerDay(days: number): Promise<TimePoint[]> {
    const { rows } = await query(
        `
        SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
               coalesce(count(x.id), 0)     AS count
          FROM generate_series(
                 date_trunc('day', now()) - ($1::int - 1) * interval '1 day',
                 date_trunc('day', now()),
                 interval '1 day'
               ) AS d(day)
          LEFT JOIN diagnoses x
                 ON x.created_at >= d.day
                AND x.created_at <  d.day + interval '1 day'
         GROUP BY d.day
         ORDER BY d.day
        `,
        [days],
    );
    return rows.map((r) => ({ day: String(r.day), count: Number(r.count) }));
}

export async function getSignupsPerDay(days: number): Promise<TimePoint[]> {
    const { rows } = await query(
        `
        SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
               coalesce(count(u.id), 0)     AS count
          FROM generate_series(
                 date_trunc('day', now()) - ($1::int - 1) * interval '1 day',
                 date_trunc('day', now()),
                 interval '1 day'
               ) AS d(day)
          LEFT JOIN users u
                 ON u.created_at >= d.day
                AND u.created_at <  d.day + interval '1 day'
         GROUP BY d.day
         ORDER BY d.day
        `,
        [days],
    );
    return rows.map((r) => ({ day: String(r.day), count: Number(r.count) }));
}

/**
 * Which specialties the model recommends. `genphen_specialties` is a JSONB
 * array whose elements may be strings or objects carrying a `name`/`especialidad`
 * key, so the shape is normalised here rather than trusted.
 */
export async function getTopSpecialties(limit: number): Promise<Bucket[]> {
    const { rows } = await query(
        `
        WITH exploded AS (
          SELECT coalesce(
                   nullif(elem #>> '{}', ''),
                   elem ->> 'name',
                   elem ->> 'especialidad',
                   elem ->> 'specialty'
                 ) AS label
            FROM diagnoses d
            CROSS JOIN LATERAL jsonb_array_elements(
              CASE WHEN jsonb_typeof(d.genphen_specialties) = 'array'
                   THEN d.genphen_specialties ELSE '[]'::jsonb END
            ) AS elem
        )
        SELECT label, count(*) AS count
          FROM exploded
         WHERE label IS NOT NULL AND label <> ''
         GROUP BY label
        HAVING count(*) >= $2
         ORDER BY count(*) DESC, label ASC
         LIMIT $1
        `,
        [limit, MIN_CELL],
    );
    return rows.map((r) => ({ label: String(r.label), count: Number(r.count) }));
}

/** Most frequent HPO phenotype terms. Same normalisation caveat as above. */
export async function getTopPhenotypes(limit: number): Promise<Bucket[]> {
    const { rows } = await query(
        `
        WITH exploded AS (
          SELECT coalesce(
                   nullif(elem #>> '{}', ''),
                   elem ->> 'name',
                   elem ->> 'label',
                   elem ->> 'hpo_id',
                   elem ->> 'id'
                 ) AS label
            FROM diagnoses d
            CROSS JOIN LATERAL jsonb_array_elements(
              CASE WHEN jsonb_typeof(d.phenotypes) = 'array'
                   THEN d.phenotypes ELSE '[]'::jsonb END
            ) AS elem
        )
        SELECT label, count(*) AS count
          FROM exploded
         WHERE label IS NOT NULL AND label <> ''
         GROUP BY label
        HAVING count(*) >= $2
         ORDER BY count(*) DESC, label ASC
         LIMIT $1
        `,
        [limit, MIN_CELL],
    );
    return rows.map((r) => ({ label: String(r.label), count: Number(r.count) }));
}

/**
 * Model confidence distribution, in ten buckets.
 *
 * Reported as a shape rather than a single average: a mean of 0.5 looks the
 * same whether the model is uniformly unsure or confidently bimodal, and those
 * call for different responses.
 */
export async function getConfidenceHistogram(): Promise<Bucket[]> {
    const { rows } = await query(`
        SELECT width_bucket(genphen_confidence, 0, 1, 10) AS bucket,
               count(*)                                   AS count
          FROM diagnoses
         WHERE genphen_confidence IS NOT NULL
         GROUP BY bucket
         ORDER BY bucket
    `);
    const byBucket = new Map<number, number>();
    for (const r of rows) byBucket.set(Number(r.bucket), Number(r.count));

    return Array.from({ length: 10 }, (_, i) => {
        const lo = (i / 10).toFixed(1);
        const hi = ((i + 1) / 10).toFixed(1);
        // width_bucket returns 11 for exactly 1.0; fold it into the top bucket.
        const count = (byBucket.get(i + 1) ?? 0) + (i === 9 ? byBucket.get(11) ?? 0 : 0);
        return { label: `${lo}–${hi}`, count };
    });
}

/**
 * Country-level only. `patients.localidad` is deliberately never aggregated:
 * a single submission from a small town can identify a family, which is the
 * exact disclosure this platform cannot afford.
 */
export async function getCountries(limit: number): Promise<Bucket[]> {
    const { rows } = await query(
        `
        SELECT coalesce(nullif(trim(pais), ''), 'Sin especificar') AS label,
               count(*) AS count
          FROM patients
         GROUP BY label
        HAVING count(*) >= $2
         ORDER BY count(*) DESC, label ASC
         LIMIT $1
        `,
        [limit, MIN_CELL],
    );
    return rows.map((r) => ({ label: String(r.label), count: Number(r.count) }));
}

export async function getAuthProviderSplit(): Promise<Bucket[]> {
    const { rows } = await query(`
        SELECT coalesce(nullif(auth_provider, ''), 'local') AS label,
               count(*) AS count
          FROM users
         GROUP BY label
         ORDER BY count(*) DESC
    `);
    return rows.map((r) => ({ label: String(r.label), count: Number(r.count) }));
}
