/**
 * The question agent's session rules, shared by the dev mock server and the
 * Playwright stubs so the two cannot drift apart.
 *
 * Faithful to the v2 contract rather than lenient: a round must answer every
 * pending question, a finished session answers 409, a resend of answers the
 * server already applied is replayed with 200, a search with no usable
 * symptoms is a 400 no retry can fix, and each round is written in the mode
 * its own request asked for, with the medical-view fields withheld from mode
 * "paciente" exactly as the agent withholds them. Responses are built from
 * `fixtures.questions`, and every error body is the backend's `{ error, code }`
 * from `fixtures.questions.errors`.
 */

const HPO_RE = /^HP:\d{7}$/;
const MODES = new Set(["paciente", "medico"]);
const ANSWERS = new Set(["si", "no", "no_se"]);
const MAX_NOTE = 280;
const MAX_ANSWERS = 3;

const clone = (value) => JSON.parse(JSON.stringify(value));

/**
 * Validates a POST /api/questions/rounds body. Returns what is wrong with it,
 * for the mock's log, or null; the browser only ever gets `invalid_request`.
 */
export function validateRoundBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body) || body.__invalidJson) {
    return "El pedido no es válido.";
  }
  if (typeof body.diagnosisId !== "string" || !body.diagnosisId) return "Falta la búsqueda a refinar.";
  if (!MODES.has(body.mode)) return "El modo tiene que ser «paciente» o «medico».";
  if (body.finish !== undefined && typeof body.finish !== "boolean") return "«finish» tiene que ser verdadero o falso.";
  if (body.answers !== undefined) {
    if (!Array.isArray(body.answers)) return "Las respuestas tienen que ser una lista.";
    if (body.answers.length > MAX_ANSWERS) return "Hay más respuestas que preguntas.";
    for (const answer of body.answers) {
      if (!answer || typeof answer !== "object") return "Hay una respuesta mal formada.";
      if (typeof answer.hpoId !== "string" || !HPO_RE.test(answer.hpoId)) return "Hay una respuesta sin un código HPO válido.";
      if (!ANSWERS.has(answer.answer)) return "Cada respuesta tiene que ser «si», «no» o «no_se».";
      if (answer.note !== undefined && answer.note !== null) {
        if (typeof answer.note !== "string") return "El comentario tiene que ser texto.";
        if (answer.note.length > MAX_NOTE) return `El comentario no puede superar los ${MAX_NOTE} caracteres.`;
      }
    }
  }
  return null;
}

function noteSummary(note) {
  const text = typeof note === "string" ? note.trim() : "";
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}${/[.!?]$/.test(text) ? "" : "."}` : null;
}

/** A blank note is stored as null, never left out, exactly as the backend stores it. */
function storedAnswer(answer) {
  const note = typeof answer.note === "string" ? answer.note.trim() : "";
  return { hpoId: answer.hpoId, answer: answer.answer, note: note || null };
}

const sameAnswers = (stored, given) =>
  stored.length === given.length &&
  given.every((answer) => stored.some((s) => s.hpoId === answer.hpoId && s.answer === answer.answer));

/**
 * One in-memory store of sessions, keyed by diagnosis id, with the backend's
 * session rules: every agent round is appended to `rounds` (the one that
 * closes the session too, with no questions), a repeated start replays the
 * latest round instead of asking again, and each round keeps the mode it was
 * written in.
 *
 * `sequence` is the list of rounds the agent will serve, in order; answering
 * round N serves sequence[N]. The last one should be a finished round.
 * `withholdMedical: false` breaks the contract on purpose, so a test can prove
 * the family view hides the medical fields on its own.
 * `noUsableSymptoms: true` makes every new session a 400, as for a search
 * whose symptoms the agent cannot ask around.
 *
 * @param {object} questionFixtures  `fixtures.questions`
 * @param {{ sequence?: object[], withholdMedical?: boolean, noUsableSymptoms?: boolean }} [options]
 */
export function createQuestionsEngine(questionFixtures, options = {}) {
  const rounds = options.sequence ?? [questionFixtures.round1, questionFixtures.round2];
  const withholdMedical = options.withholdMedical ?? true;
  const noUsableSymptoms = options.noUsableSymptoms ?? false;
  const { errors, medico, summaries } = questionFixtures;
  const sessions = new Map();
  const locks = new Set();

  /** The backend's error response for `code`: `{ status, body: { error, code } }`. */
  function failure(code) {
    const known = errors[code];
    if (!known || code === "_comment") throw new Error(`unknown question error code: ${code}`);
    return { status: known.status, body: { error: known.error, code } };
  }

  /** A template round, written for `mode` as the agent would write it. */
  function written(template, mode) {
    const response = clone(template);
    delete response._comment;
    response.mode = mode;
    response.questions = response.questions.map((question) => {
      if (mode === "medico") {
        const wording = medico.questions[question.hpoId];
        return wording ? { ...question, text: wording.text, help: wording.help } : question;
      }
      return withholdMedical ? { ...question, rationale: null, genesIfYes: null, genesIfNo: null } : question;
    });
    return response;
  }

  function close(response, mode, answeredAny, reason) {
    response.status = "finished";
    response.finishReason = reason;
    response.questions = [];
    response.summary = summaries[answeredAny ? "refined" : "early"][mode];
    return response;
  }

  /** The body of GET /api/questions/:diagnosisId. No session-level mode: each round has its own. */
  function session(diagnosisId) {
    const stored = sessions.get(diagnosisId);
    if (!stored) return { session: null };
    return { session: { finished: stored.finished, rounds: clone(stored.rounds), latest: clone(stored.latest) } };
  }

  function record(stored, response) {
    stored.latest = response;
    stored.finished = response.status === "finished";
    stored.rounds.push({ round: response.round, mode: response.mode, questions: response.questions, answers: [] });
    return { status: 200, body: clone(response) };
  }

  /** Returns `{ status, body }` for a POST /api/questions/rounds body. */
  function round(body) {
    const invalid = validateRoundBody(body);
    if (invalid) return failure("invalid_request");

    const mode = body.mode;
    const answers = body.answers ?? [];
    const finish = body.finish === true;
    const stored = sessions.get(body.diagnosisId);

    const current = stored?.rounds.at(-1);
    const pending = current && current.questions.length > 0 && current.answers.length === 0 ? current : null;
    const lastAnswered = stored?.rounds.findLast((entry) => entry.answers.length > 0);

    // The reply to an applied round was lost and the browser sent it again.
    if (answers.length > 0 && !pending && lastAnswered && sameAnswers(lastAnswered.answers, answers)) {
      return { status: 200, body: clone(stored.latest) };
    }
    if (stored?.finished) return failure("finished");

    if (answers.length > 0) {
      const asked = new Set((pending?.questions ?? []).map((question) => question.hpoId));
      const given = new Set(answers.map((answer) => answer.hpoId));
      if (!pending || given.size !== answers.length || given.size !== asked.size || [...asked].some((id) => !given.has(id))) {
        return failure("answers_mismatch");
      }
    }

    if (!stored) {
      if (noUsableSymptoms) return failure("no_usable_symptoms");
      const fresh = { finished: false, served: 1, rounds: [], latest: null, interpreted: [] };
      sessions.set(body.diagnosisId, fresh);
      const first = written(rounds[0], mode);
      return record(fresh, finish ? close(first, mode, false, "user_finished") : first);
    }

    if (answers.length === 0 && !finish) return { status: 200, body: clone(stored.latest) };

    const answeredAny = stored.interpreted.length > 0 || answers.length > 0;
    if (answers.length === 0) {
      const closing = written({ ...stored.latest, questions: [] }, mode);
      closing.interpretedAnswers = clone(stored.interpreted);
      return record(stored, close(closing, mode, answeredAny, "user_finished"));
    }

    pending.answers = answers.map(storedAnswer);
    for (const answer of answers) {
      stored.interpreted = stored.interpreted.filter((item) => item.hpoId !== answer.hpoId);
      stored.interpreted.push({
        hpoId: answer.hpoId,
        answer: answer.answer,
        effectiveAnswer: answer.answer,
        noteSummary: noteSummary(answer.note),
      });
    }
    const next = written(rounds[Math.min(stored.served, rounds.length - 1)], mode);
    stored.served += 1;
    next.round = pending.round + 1;
    next.interpretedAnswers = clone(stored.interpreted);
    if (finish) close(next, mode, true, "user_finished");
    else if (next.status === "finished") close(next, mode, true, next.finishReason);
    return record(stored, next);
  }

  /**
   * One round at a time per account, as the backend holds it: a second one
   * while the first is with the agent is a 429 that clears in seconds.
   * Returns a release function, or null when a round is already running.
   */
  function tryAcquire(key) {
    if (locks.has(key)) return null;
    locks.add(key);
    return () => locks.delete(key);
  }

  const inFlightError = { ...failure("round_in_flight"), retryAfter: "10" };

  /**
   * The platform's own cap on rounds, which the backend enforces across every
   * account to bound what the agent costs. It says when rounds come back,
   * usually hours away, and it is nobody's own doing.
   */
  const globalLimitError = { ...failure("global_limit"), retryAfter: "7200" };

  /**
   * Seeds a session as if it had been played already, for resume tests.
   *
   * @param {string} diagnosisId
   * @param {{ finished: boolean, rounds: object[], latest: object }} value
   */
  function seed(diagnosisId, value) {
    const interpreted = clone(value.latest?.interpretedAnswers ?? []);
    sessions.set(diagnosisId, { served: value.rounds.length, interpreted, ...clone(value) });
  }

  return { round, session, seed, tryAcquire, inFlightError, globalLimitError, failure, written };
}
