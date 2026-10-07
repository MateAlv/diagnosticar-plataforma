/**
 * Logs a failure without the values that caused it. A Postgres error quotes
 * the rejected input in its message and detail ("invalid input syntax for type
 * date: …", "Key (email)=(…) already exists"), and on these routes the input
 * is clinical data or an email. The SQLSTATE code and the stack are enough to
 * find the bug.
 */
export function logError(label: string, error: unknown): void {
    if (!(error instanceof Error)) {
        console.error(label, typeof error);
        return;
    }
    const code = (error as { code?: unknown }).code;
    const frames = error.stack?.split('\n').slice(1).join('\n') ?? '';
    console.error(`${label} ${error.name}${typeof code === 'string' ? ` code=${code}` : ''}\n${frames}`);
}
