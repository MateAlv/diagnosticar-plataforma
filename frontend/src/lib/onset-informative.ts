import list from "./onset-informative-terms.json";
import { onsetInformativeIds } from "./onset";

/**
 * Terms for which the age a symptom began changes which genes are likely.
 * Read from onset-informative-terms.json, so a new list is a file swap.
 */
const IDS = onsetInformativeIds(list);

export const ONSET_LIST_VERSION: string = typeof (list as { version?: unknown }).version === "string"
    ? (list as { version: string }).version
    : "unknown";

export function isOnsetInformative(code: string): boolean {
    return IDS.has(code.trim().toUpperCase());
}
