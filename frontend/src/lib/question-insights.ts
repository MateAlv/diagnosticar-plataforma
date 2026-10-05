/**
 * What the follow-up answers did to the gene list, and the plain-text sheet a
 * reader takes to the consultation, as pure functions.
 *
 * Every sentence here talks about a gene's place in a list, never about how
 * likely it is: the refined score is a posterior the screen never shows, and
 * "subió" must not read as "closer to the answer".
 */

import { onsetReportLines, type ReportedSymptom } from "./onset";
import type { QuestionSessionState } from "./question-session";
import { answerLabel, type AnsweredQuestion, type AnswerValue, type RankedGeneRow } from "./questions-api";

export type MoveDirection = "up" | "down" | "same" | "new";
/** A gene's place in two lists; `from` is null for a gene the earlier list did not have. */
export type RankMove = { symbol: string; from: number | null; to: number };

const key = (symbol: string) => symbol.trim().toUpperCase();

export function symbolOf(row: RankedGeneRow): string {
    return row.geneSymbol || row.geneId;
}

export function moveDirection(from: number | null, to: number): MoveDirection {
    if (from === null) return "new";
    if (from === to) return "same";
    return to < from ? "up" : "down";
}

/**
 * "↑ 3.º → 2.º" for the eye, and the whole sentence for a screen reader,
 * which would otherwise read out arrows and ordinals.
 */
export function describeMove(from: number | null, to: number): { text: string; label: string; direction: MoveDirection } {
    const direction = moveDirection(from, to);
    if (direction === "new") {
        return { text: "nuevo", label: `Entra en la lista con tus respuestas, en el puesto ${to}.`, direction };
    }
    if (direction === "same") {
        return { text: `= ${to}.º`, label: `Sigue en el puesto ${to}.`, direction };
    }
    return {
        text: `${direction === "up" ? "↑" : "↓"} ${from}.º → ${to}.º`,
        label: `${direction === "up" ? "Subió" : "Bajó"} del puesto ${from} al ${to} con tus respuestas.`,
        direction,
    };
}

/** The tooltip on a card's movement in the list with the answers. */
export const MOVE_TITLE =
    "Lugar que tenía en la lista que viste antes de las preguntas. Estar más arriba no quiere decir que sea la respuesta.";

/** The tooltip on a card that the list with the answers brought in. */
export const NEW_TITLE =
    "No estaba en la lista que viste antes de las preguntas: entra cuando el modelo la vuelve a ordenar con los síntomas que confirmaste.";

/** A card's movement from its place in the list shown before the questions. */
export function rankMovement(rank: number, from: number | null) {
    return { ...describeMove(from, rank), title: from === null ? NEW_TITLE : MOVE_TITLE };
}

/** 1-based place of each symbol in a list, by upper-cased symbol. */
export function ranksOf(symbols: string[]): Map<string, number> {
    return new Map(symbols.map((symbol, index) => [key(symbol), index + 1]));
}

/**
 * Where each gene of `after` stood in `before`, by upper-cased symbol: its
 * 1-based place there, or null for one `before` did not have.
 *
 * Movement is always measured this way, between two lists the reader has
 * seen, and never from the ranking's `modelRank`: the agent re-runs the model
 * each round, so that field is the gene's place in the new list itself.
 */
export function originsIn(before: string[], after: string[]): Map<string, number | null> {
    const places = ranksOf(before);
    return new Map(after.map((symbol) => [key(symbol), places.get(key(symbol)) ?? null]));
}

export type ListChanges = {
    /** The genes that moved or came in, most-moved first, at most `limit` of them. */
    moves: RankMove[];
    /** The gene still first, when it did not move. */
    steadyTop: RankMove | null;
    /** Every gene that moved or came in, including those past the limit. */
    movedCount: number;
    /**
     * Genes of `before` that fell out of `after`, in their order there. Only
     * those `before` placed within the length of `after`: a shorter list
     * leaving out its tail is not news.
     */
    dropped: string[];
};

/**
 * How the list changed from `before` to `after`. A gene that came in counts
 * as having moved up from just past the end of `before`, so one arriving at
 * the top outranks a small shuffle, and one arriving at the bottom does not.
 */
export function listChanges(before: string[], after: string[], limit = 4): ListChanges {
    const places = ranksOf(before);
    const reach = (move: RankMove) => Math.abs((move.from ?? before.length + 1) - move.to);
    const moves: RankMove[] = [];
    after.forEach((symbol, index) => {
        const from = places.get(key(symbol)) ?? null;
        if (from !== index + 1) moves.push({ symbol, from, to: index + 1 });
    });
    moves.sort((a, b) => reach(b) - reach(a) || a.to - b.to);
    const kept = new Set(after.map(key));
    const top = after[0];
    return {
        moves: moves.slice(0, limit),
        steadyTop: top !== undefined && places.get(key(top)) === 1 ? { symbol: top, from: 1, to: 1 } : null,
        movedCount: moves.length,
        dropped: before.filter((symbol, index) => index < after.length && !kept.has(key(symbol))),
    };
}

/**
 * What made the list with the answers. The agent sends the model only the
 * findings answered «Sí», as extra symptoms, and the model ranks again: no
 * single answer moved a given gene, so no move is credited to one.
 */
export const RERANK_NOTE = "El modelo volvió a ordenar la lista con los síntomas que confirmaste.";

/** Said on a gene of that list that is not where the list before the questions had it. */
export const MOVED_NOTE = "Se movió cuando el modelo volvió a ordenar la lista con los síntomas que confirmaste.";

/** Said on a gene of that list that the list before the questions did not have. */
export const ENTERED_NOTE = "Entró en la lista cuando el modelo la volvió a ordenar con los síntomas que confirmaste.";

export type SessionChanges = {
    /** What the list is compared against, as the receipt says it. */
    caption: string;
    result: ListChanges;
};

/**
 * What the answers changed, for the receipt.
 *
 * `"round"` measures the latest round against the list with the answers as
 * it stood before it; `"session"` measures the list with the answers against
 * `original`, the model's list the page showed before the questions. After a
 * reload the list before the latest round is not known, and a round falls
 * back to the session's view, saying so in its caption. Null until something
 * was answered.
 */
export function sessionChanges(
    state: Pick<QuestionSessionState, "refined" | "history" | "lastChange">,
    scope: "round" | "session",
    original: string[],
): SessionChanges | null {
    const { refined, history, lastChange } = state;
    if (!refined || history.length === 0) return null;
    const after = refined.ranking.map(symbolOf);
    if (scope === "round" && lastChange?.before) {
        return { caption: "Respecto de la lista anterior", result: listChanges(lastChange.before.map(symbolOf), after) };
    }
    return { caption: "Respecto de la lista original", result: listChanges(original, after) };
}

/**
 * The genes the agent associates with a finding answered «Sí», which the
 * medical table lists against it. A «No» or a «No sé» reaches no list, so it
 * has none.
 */
export function associatedGenes(item: AnsweredQuestion): string[] {
    return item.effectiveAnswer === "si" ? (item.question.genesIfYes ?? []) : [];
}

export type AnswerGroups = Record<AnswerValue, AnsweredQuestion[]>;

/** By what the agent took each answer to mean, which a note can change. */
export function groupAnswers(history: AnsweredQuestion[]): AnswerGroups {
    const groups: AnswerGroups = { si: [], no: [], no_se: [] };
    for (const item of history) groups[item.effectiveAnswer].push(item);
    return groups;
}

export const GROUP_TITLES: Record<AnswerValue, string> = {
    si: "Dijiste que sí",
    no: "Dijiste que no",
    no_se: "No sabías",
};

/**
 * Said wherever the order adjusted by the answers is shown. On 501 published
 * patients it ranked no better than the model's own order, so it is offered
 * as a second view, never as the result.
 */
export const ADJUSTED_LIST_NOTE = "La lista con tus respuestas es orientativa: todavía estamos evaluando si mejora el orden.";

export type ConsultSheet = {
    title: string;
    summary: string;
    /** Why the questions ended, in words that claim no certainty. */
    finishNote: string | null;
    changes: SessionChanges | null;
    history: AnsweredQuestion[];
    /** Symptoms of the search; those with a reported onset are written into the text. */
    symptoms?: ReportedSymptom[];
    professional: boolean;
    /** The model's own list, in order: always the sheet's list. */
    genes: string[];
    /** The order adjusted by the answers, only when the reader chose to see it. */
    adjustedGenes: string[] | null;
    disclaimer: string;
    date: Date;
};

function moveSentence(move: RankMove): string {
    const direction = moveDirection(move.from, move.to);
    if (direction === "new") return `${move.symbol} entra en la lista en el puesto ${move.to}`;
    if (direction === "same") return `${move.symbol} sigue en el puesto ${move.to}`;
    return `${move.symbol} ${direction === "up" ? "subió" : "bajó"} del puesto ${move.from} al ${move.to}`;
}

/** "Quedaron fuera de esta lista: DNAH5 y SCNN1A.", or the count past three. */
export function droppedSentence(dropped: string[]): string | null {
    if (dropped.length === 0) return null;
    if (dropped.length > 3) return `${dropped.length} genes de la lista anterior quedaron fuera de esta.`;
    return `Quedaron fuera de esta lista: ${LIST_FORMAT.format(dropped)}.`;
}

const LIST_FORMAT = new Intl.ListFormat("es", { style: "long", type: "conjunction" });

const quoted = (note: string) => `«${note}»`;

/**
 * The summary as plain text, for a message or a note on the phone. It carries
 * the disclaimer word for word, since it leaves the page without it.
 *
 * The family version names findings by their label and names no genes
 * against them; the medical one lists the HPO id and, for each «Sí», the
 * genes the agent associates with it.
 */
export function buildConsultText(sheet: ConsultSheet): string {
    const date = sheet.date.toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" });
    const blocks: string[] = [`${sheet.title}\nDiagnostic.ar · ${date}`];

    blocks.push([sheet.summary, sheet.finishNote].filter(Boolean).join("\n"));

    const onsetLines = onsetReportLines(sheet.symptoms ?? []);
    if (onsetLines.length > 0) blocks.push(["Síntomas informados:", ...onsetLines].join("\n"));

    if (sheet.changes) {
        const { caption, result } = sheet.changes;
        const lines = [...result.moves, ...(result.steadyTop ? [result.steadyTop] : [])].map((move) => `- ${moveSentence(move)}.`);
        const left = droppedSentence(result.dropped);
        blocks.push(
            [
                `Qué cambió con tus respuestas (${caption.toLowerCase()}):`,
                RERANK_NOTE,
                ...(lines.length ? lines : ["- Ningún gen cambió de lugar."]),
                ...(left ? [left] : []),
            ].join("\n"),
        );
    }

    if (sheet.history.length > 0) {
        if (sheet.professional) {
            const rows = sheet.history.map((item) => {
                const parts = [`- ${item.question.hpoId} ${item.question.label}: ${answerLabel(item.effectiveAnswer)}.`];
                if (item.effectiveAnswer !== item.answer) parts.push(`Marcó «${answerLabel(item.answer)}»; se tomó por su nota.`);
                if (item.note) parts.push(`Nota: ${quoted(item.note)}.`);
                const genes = associatedGenes(item);
                if (genes.length > 0) parts.push(`Asociado a: ${genes.join(", ")}.`);
                return parts.join(" ");
            });
            blocks.push(["Respuestas:", ...rows].join("\n"));
        } else {
            const groups = groupAnswers(sheet.history);
            const lines = (Object.keys(GROUP_TITLES) as AnswerValue[])
                .filter((answer) => groups[answer].length > 0)
                .map(
                    (answer) =>
                        `${GROUP_TITLES[answer]}: ${groups[answer]
                            .map((item) => (item.note ? `${item.question.label} (${quoted(item.note)})` : item.question.label))
                            .join("; ")}.`,
                );
            blocks.push(["Lo que respondiste:", ...lines].join("\n"));
        }
    }

    const numbered = (genes: string[]) => genes.map((gene, index) => `${index + 1}. ${gene}`).join(" · ");
    if (sheet.genes.length > 0) {
        blocks.push(
            `Genes sugeridos, en el orden original del modelo (el orden es orientativo; el primero no es una respuesta):\n${numbered(sheet.genes)}`,
        );
    }
    if (sheet.adjustedGenes && sheet.adjustedGenes.length > 0) {
        blocks.push(`Orden con tus respuestas. ${ADJUSTED_LIST_NOTE}\n${numbered(sheet.adjustedGenes)}`);
    }

    blocks.push(sheet.disclaimer);
    return blocks.join("\n\n");
}
