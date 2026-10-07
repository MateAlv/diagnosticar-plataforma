import { getClient } from '../database/pool.js';

export type AccountDeletion =
    | { outcome: 'deleted'; patients: number; diagnoses: number }
    | { outcome: 'not_found' }
    | { outcome: 'last_admin' }
    | { outcome: 'foreign_rows' };

/**
 * Deletes an account and everything it loaded, in one transaction.
 *
 * Every table that holds an account's data points at `users` with ON DELETE
 * CASCADE, so removing the row removes its patients, their diagnoses and its
 * question-agent rounds, and nothing that hangs off another account. Two
 * guards keep the cascade from reaching further than that:
 *
 * - A diagnosis is reachable from both its patient and its author. If one of
 *   this account's patients carries a diagnosis written by someone else, the
 *   patient's cascade would take it too; that never happens through the API,
 *   so finding one means the data is inconsistent and nothing is deleted.
 * - The last admin cannot delete themselves: the backoffice would be left
 *   with nobody able to manage it.
 */
export async function deleteAccount(userId: string): Promise<AccountDeletion> {
    const client = await getClient();
    try {
        await client.query('BEGIN');

        const { rows: users } = await client.query<{ role: string | null }>(
            'SELECT role FROM users WHERE id = $1 FOR UPDATE',
            [userId],
        );
        if (users.length === 0) {
            await client.query('ROLLBACK');
            return { outcome: 'not_found' };
        }

        if (users[0].role === 'admin') {
            const { rows: admins } = await client.query<{ id: string }>(
                "SELECT id FROM users WHERE role = 'admin' AND id <> $1 FOR UPDATE",
                [userId],
            );
            if (admins.length === 0) {
                await client.query('ROLLBACK');
                return { outcome: 'last_admin' };
            }
        }

        const { rows: foreign } = await client.query<{ count: string }>(
            `SELECT count(*) AS count
               FROM diagnoses d
               JOIN patients p ON p.id = d.patient_id
              WHERE p.user_id = $1 AND d.user_id <> $1`,
            [userId],
        );
        if (Number(foreign[0].count) > 0) {
            await client.query('ROLLBACK');
            return { outcome: 'foreign_rows' };
        }

        const { rows: counts } = await client.query<{ patients: string; diagnoses: string }>(
            `SELECT (SELECT count(*) FROM patients WHERE user_id = $1) AS patients,
                    (SELECT count(*) FROM diagnoses WHERE user_id = $1) AS diagnoses`,
            [userId],
        );

        const deleted = await client.query('DELETE FROM users WHERE id = $1', [userId]);
        if (deleted.rowCount !== 1) {
            await client.query('ROLLBACK');
            return { outcome: 'not_found' };
        }

        await client.query('COMMIT');
        return {
            outcome: 'deleted',
            patients: Number(counts[0].patients),
            diagnoses: Number(counts[0].diagnoses),
        };
    } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
    } finally {
        client.release();
    }
}
