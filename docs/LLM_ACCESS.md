# How we call LLMs: the codex CLI adapter

**Decision (Mate, 2026-09-19): whenever a module needs an LLM, go through the
`codex` CLI rather than a paid API key.** The subscription is already paid for;
per-token API billing for three modules is not. Everything below is written so
that decision is implementable rather than just stated.

All three incoming modules assume API keys today: the recognizer reads
`OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` directly through each
vendor SDK, and the question agent requires `OPENAI_API_KEY` for both chat and
embeddings. **An adapter is therefore required work, not an optimisation.**

---

## Verified: it works

Tested on TARS, 2026-09-19, with `codex-cli 0.155.1` at
`/home/<usuario>/.local/bin/codex`:

```bash
codex exec --skip-git-repo-check --output-schema schema.json -o out.json \
  "Map these Spanish clinical mentions to HPO ids. Mentions: fiebre, nauseas, convulsiones" </dev/null
```

Result — exit 0, **10 seconds**, 15,336 tokens, and `out.json` containing
schema-conformant JSON with all three codes correct:

```json
{"hpo_codes":[{"mention":"fiebre","hpo_id":"HP:0001945"},
              {"mention":"nauseas","hpo_id":"HP:0002018"},
              {"mention":"convulsiones","hpo_id":"HP:0001250"}]}
```

Those match the expected values in the recognizer's own
`examples/ex2_simple_hpo_mapping.py`, including preferring the more specific
HP:0002018 (Nausea) over HP:0002017 (Nausea and vomiting).

The flags that make this usable as a library call:

| Flag | Why it matters |
|---|---|
| `--output-schema <file>` | JSON Schema for the final response — gives structured output, no prose parsing |
| `-o, --output-last-message <file>` | Writes just the final message, so we never scrape the transcript |
| `--json` | JSONL event stream, if progress or tool events are ever needed |
| `--skip-git-repo-check` | Required — the module dirs are not all git repos |
| `-m, --model` | Model selection per call site |
| `-c key=value` | Config override without touching `~/.codex/config.toml` |

### The trap that cost time here

**`codex exec` reads stdin when it is piped or empty**, printing
`Reading additional input from stdin...` and hanging forever. The first attempt
looked like a >120s latency problem and was actually a blocked read.

**Always redirect stdin from `/dev/null`** in any programmatic call. The
adapter must do this itself, and a timeout must wrap every call regardless.

---

## What the adapter must be

A small Python module — one file, no framework — exposing the shape the modules
already expect, so each module changes at one seam instead of throughout:

```python
codex_adapter.complete(prompt: str, *, schema: dict | None = None,
                       model: str | None = None,
                       timeout: int = 120) -> dict | str
```

Requirements, each from something observed above:

1. **`stdin=DEVNULL` always.** Non-negotiable; see the trap.
2. **A hard timeout on every call**, with a clear exception. A wedged CLI
   process must not hang a web request.
3. **Write the schema and output to temp files** and clean them up. Never in
   the repo tree.
4. **Never pass patient text as a shell argument.** Use `subprocess` with an
   argument list, never `shell=True`. Clinical text containing quotes or `$`
   would otherwise corrupt the call or worse — and remember `$$` in a shell
   context becomes a PID.
5. **Validate the returned JSON against the schema** before handing it back. A
   schema request is not a schema guarantee.
6. **Retry once on malformed output**, then fail loudly. No silent fallback to
   a worse model: a quietly degraded clinical mapping is worse than an error.
7. **Log the model, elapsed time and token count; never log the prompt**, which
   contains clinical text.
8. **A drop-in shim per module.** For the recognizer, a provider that satisfies
   the same interface as `symptoms_recognizer/api_clients.py`. For the question
   agent, a LangChain-compatible `LLM` subclass.

### Hard constraints — read before planning around this

- **Interactive latency.** 10s for three short mentions, at default `reasoning
  effort: high`. A full clinical history with top-K re-ranking will be well
  beyond that. **This cannot sit in a synchronous browser request.** Any
  codex-backed path must be async (job + poll) or clearly presented as "this
  takes a moment". Measure before designing the UX around it.
- **No embeddings endpoint.** `codex exec` does chat-style completion. The
  question agent needs embeddings for Chroma, and those **cannot come from
  codex**. Options: a local sentence-transformers model, Ollama (already on
  this box and already used by the current pipeline), or accept an API key for
  embeddings alone. **Unresolved — a task in the plan.**
- **Subscription rate limits, not per-token billing.** Cheap per call, but
  throttled and not something to call in a loop per request. A cache keyed on
  the hash of the input is likely mandatory, and the existing pipeline already
  has Redis caching to imitate.
- **Not a server.** Each call spawns a process with real startup cost. Batch
  mentions into one call rather than one call per mention.
- **Interactive auth.** `codex` is authenticated as a logged-in user on this
  machine. A container on nodo0 has no such session. **This is the reason
  codex-backed paths are a local/dev story first** — production needs either a
  mounted credential, a service that proxies to this box, or an API key after
  all. Decide before anything codex-backed is proposed for deployment.

**Consequence for sequencing:** the adapter is fine for local correctness
testing and benchmarking now, and its production story is genuinely open. Do
not let "it works on TARS" be mistaken for "it works on nodo0".

---

## Where the adapter is used

| Module | Needs an LLM for | Adapter status |
|---|---|---|
| Symptom recognizer | NER stage; mapping re-rank (best config = `claude-opus-5`) | Required |
| Question agent | Question generation | Required |
| Question agent | Chroma embeddings | **Not possible via codex** — separate decision |
| Gene explanation DB | Nothing at query time | Not needed |

The gene DB needs no LLM to serve, which is another reason it is first.
