import type { PoolClient } from 'pg';
import { getClient, pruneQuestionAgentRounds, query } from '../database/pool.js';

// Fixed, like the migration lock: every backend process charging a round must
// wait on the same key, or two of them can both see room for the last one.
const ROUND_BUDGET_LOCK_ID = 8_472_002;

const ACCOUNT_WINDOW_SECONDS = 60 * 60;
const GLOBAL_WINDOW_SECONDS = 5 * 60 * 60;

export type RoundLimits = {
    perAccountPerHour: number;
    globalPer5h: number;
};

export type RoundCharge =
    | { status: 'charged'; roundId: string }
    | { status: 'global_limit' | 'account_limit'; retryAfterSeconds: number };

/**
 * Records a round about to be sent to the agent, unless it would exceed the
 * deployment-wide cap or the account's. The count and the insert happen under
 * one transaction-scoped advisory lock, so concurrent requests, in this process
 * or another, cannot both take the last slot.
 */
export async function chargeQuestionRound(userId: string, limits: RoundLimits): Promise<RoundCharge> {
    const client = await getClient();
    try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock($1)', [ROUND_BUDGET_LOCK_ID]);

        const globalWait = await secondsUntilRoom(client, GLOBAL_WINDOW_SECONDS, limits.globalPer5h, null);
        if (globalWait > 0) {
            await client.query('ROLLBACK');
            return { status: 'global_limit', retryAfterSeconds: globalWait };
        }
        const accountWait = await secondsUntilRoom(client, ACCOUNT_WINDOW_SECONDS, limits.perAccountPerHour, userId);
        if (accountWait > 0) {
            await client.query('ROLLBACK');
            return { status: 'account_limit', retryAfterSeconds: accountWait };
        }

        const inserted = await client.query<{ id: string }>(
            'INSERT INTO question_agent_rounds (user_id) VALUES ($1) RETURNING id',
            [userId],
        );
        await pruneQuestionAgentRounds(client);
        await client.query('COMMIT');
        return { status: 'charged', roundId: String(inserted.rows[0].id) };
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

/** Gives a round back when the agent refused it before doing any work. */
export async function refundQuestionRound(roundId: string): Promise<void> {
    await query('DELETE FROM question_agent_rounds WHERE id = $1', [roundId]);
}

/**
 * Seconds until the window has room for one more round, or 0 if it has room
 * now. Room opens when the `max`-th most recent round ages out, which is the
 * oldest one unless the cap was lowered below what is already recorded.
 */
async function secondsUntilRoom(
    client: PoolClient,
    windowSeconds: number,
    max: number,
    userId: string | null,
): Promise<number> {
    const res = await client.query<{ wait: number }>(
        `SELECT ceil(extract(epoch FROM created_at + make_interval(secs => $1) - now()))::int AS wait
         FROM question_agent_rounds
         WHERE created_at > now() - make_interval(secs => $1)
           AND ($3::uuid IS NULL OR user_id = $3::uuid)
         ORDER BY created_at DESC
         OFFSET $2 LIMIT 1`,
        [windowSeconds, max - 1, userId],
    );
    if (res.rows.length === 0) return 0;
    return Math.max(1, res.rows[0].wait);
}
