# Exa API Findings — 2026-05-15

Empirical findings from cross-comparing Exa's `/search` and `/research` endpoints on a single fact-retrieval task (Notion database property types). Cost, latency, accuracy, and failure-mode data — useful when deciding which Exa surface to call from `pi-exa` and how to configure it.

The test prompt across all runs was a comprehensive catalog request: "list every property type Notion's database API supports — for each, the API type identifier, writable status, JSON wire shape, and gotchas." A known-correct answer existed (Notion's own docs at `developers.notion.com`), making this a clean spec-correctness benchmark.

---

## TL;DR

**`/research/v0` and `/research/v1` are being retired.** Replace them with `/search type=deep-reasoning` plus `additionalQueries` for fan-out discovery.

**For spec lookup against a known authoritative source, `/search type=deep` + `includeDomains` is ~80× cheaper and faster than `/research/v1`, and the only configuration that didn't hallucinate** on the known-hallucination test case (Notion's `place` property).

**Single highest-impact lever**: `includeDomains`. Setting it to an authoritative domain is the difference between accurate output and confident hallucination — observed identically across `/research/v0`, `/research/v1`, and `/search deep-reasoning` runs that lacked the filter.

---

## Endpoints tested

### 1. `POST /research/v0/tasks` (retiring)

- Async; POST returns task ID, GET polls until status=completed.
- Returns structured JSON with auto-generated schema inferred from the prose instructions.
- Embedded per-entry `sourceURLs[]` citations.
- Has an `operations` field with internal-step trace.
- **Field name gotcha**: schema field is `outputSchema` (camelCase), not `output_schema`.

### 2. `POST /research/v1` (retiring)

- Async; same poll-until-done pattern.
- Returns prose markdown in `output.content` (no auto-schema).
- Separate top-level `citations` array.
- Adds `GET /research/v1` listing endpoint that returns all prior research tasks for an API key — useful side-channel for debugging, but **shared API keys leak prior prompt history** to anyone who can call this endpoint.
- ID field is `researchId` (not `id`).
- URL structure drops the `/tasks` segment.

### 3. `POST /search` (current; replaces both research endpoints)

- Sync; single request/response.
- `type` parameter selects search depth: `instant`, `fast`, `auto`, `deep-lite`, `deep`, `deep-reasoning`.
- Caller controls `outputSchema` directly (no auto-inference).
- Returns `output.content` (string or structured) plus `output.grounding` with per-field citations.
- Supports the steering levers: `includeDomains`, `excludeDomains`, `systemPrompt`, `additionalQueries`, `numResults`.

---

## Measurements (Notion property types task)

Same prompt, same desired output, five different configurations:

| Run | Endpoint | type | Steering | Latency | Cost | Types covered | `place` correct? | Easy cases correct? |
|---|---|---|---|---|---|---|---|---|
| A | `/research/v0/tasks` | n/a | (single query) | ~45s | $0.043 | 23 | ❌ writable + fabricated Reddit URL | ✅ |
| B | `/research/v1` | n/a | (single query) | ~370s | $0.979 | 19 | ❌ writable + fabricated `{lat, lon, name, address}` | ✅ |
| C | `/search` | `deep` | `includeDomains: [developers.notion.com]` + permissive systemPrompt + outputSchema | ~15s | $0.012 | 24 | ✅ unsupported | ✅ |
| D | `/search` | `deep-reasoning` | `includeDomains: [developers.notion.com]` + **strict** systemPrompt + outputSchema | ~13s | $0.015 | 24 | ✅ unsupported (best detail) | ❌ over-classified title/date/checkbox/etc. as unsupported |
| E | `/search` | `deep-reasoning` | No `includeDomains` + 7 `additionalQueries` + permissive systemPrompt + outputSchema | ~71s | $0.034 | 24 | ❌ writable + same Reddit-derived `{lat, lon}` shape as B | ✅ |

**Cost ratios** (relative to cheapest run, C): A is 3.6×, B is 81×, D is 1.25×, E is 2.8×.

**The cheapest accurate run was 80× cheaper than the most expensive inaccurate run.**

---

## Failure modes observed

### Mode 1: Confident-wrong on a hallucination-magnet topic

Runs A, B, and E all produced the same wrong answer about Notion's `place` property — classified it as writable, fabricated a wire shape (`{lat, lon, name, address}` or similar), and cited a Reddit URL that doesn't back up the claim. The hallucination is consistent across runs because the same misinformation exists in the model's training data / community-source pool, and broad-fan-out retrieval pulls it in alongside (or instead of) the authoritative docs.

**The actual truth** (per `https://developers.notion.com/reference/page-property-values#unsupported-properties`): place is in the schema enum but reads return `null` and writes are unsupported. The docs explicitly say "Exclude these unsupported types when you are updating page properties."

**Mitigation**: `includeDomains` filtered to the authoritative source (run C) — only run that got it right. Run D also got it right because of the same filter, but had a different failure mode (below).

### Mode 2: Over-cautious collapse under strict systemPrompt + low numResults

Run D used `type: "deep-reasoning"` with a strict systemPrompt ("don't fabricate wire shapes — omit if not in docs") and `numResults: 8`. The model couldn't find every property type's exact wire shape in the 8 retrieved pages and conservatively classified `title`, `date`, `checkbox`, `people`, `files`, and `verification` as unsupported — even though they're clearly writable per the same docs the filter was pointing at.

**Insight**: `deep-reasoning`'s extra reasoning per step amplifies whatever the systemPrompt + retrieved-page corpus push it toward. With a "don't fabricate" instruction and limited retrieval, it pushes toward "I don't know → unsupported". With permissive instructions and broad retrieval, it pushes the other way (hallucination).

**Mitigation**: when using `deep-reasoning` with strict steering, **raise `numResults` to 20-30** so the model has enough context to find the answers rather than defaulting to "unknown".

### Mode 3: Source-pollution

Run E used `deep-reasoning` + `additionalQueries` with no `includeDomains` — the closest behavioral match to `/research/v1`. The domain spread of retrieved pages was: 12 from `developers.notion.com`, 17 from `github.com`, `apidog.io`, `notionthings.com`, `latenode.com`, `n8n.io`, `youtube.com`, `hexdocs.pm`. The community sources contained the false claim that place is writable; the model defaulted to that consensus even though Notion's own docs (also retrieved) disagreed.

**This is not a `/research`-specific bug.** Both `/research/v0`, `/research/v1`, and `/search deep-reasoning` fan-out runs reproduced it. It's a property of broad-fan-out retrieval without domain filtering.

---

## Parameter reference (from the `/search` docs)

### `type` values

| `type` | Latency | Use for |
|---|---|---|
| `instant` | ~250 ms | Real-time apps (chat, voice, autocomplete) |
| `fast` | ~450 ms | Optimized search with good relevance |
| `auto` (default) | ~1s | Router picks per-query; balanced default |
| `deep-lite` | ~4s | Lightweight synthesis; cheaper than full `deep` |
| `deep` | 4-15s | Multi-step planning with structured outputs |
| `deep-reasoning` | 12-40s (more with `additionalQueries`) | Maximum reasoning capability per step |

### Key steering levers

| Parameter | When to use | Effect |
|---|---|---|
| `includeDomains` | Authoritative source is known | Restricts retrieval to listed domains. **Highest-leverage parameter for spec correctness.** |
| `excludeDomains` | Known noise source | Filters out specific domains. Max 1200 entries. |
| `systemPrompt` | Specific guidance on synthesis or source preference | Instructions for the synthesis step. Interacts with `type` — see Mode 2 above. |
| `additionalQueries` | Discovery work; unknown sources | Extra query variations explored as parallel branches in `deep`/`deep-reasoning`. Multiplies cost and latency roughly linearly. |
| `outputSchema` | Need structured JSON output | Caller-controlled JSON Schema. Max nesting depth 2, max 10 total properties. |
| `numResults` | Trade off retrieval breadth vs cost | 1-100. Defaults to 10. Raise to 20-30 when using strict systemPrompts. |
| `contents.highlights: true` | Agent workflows | ~10× fewer tokens than full `text`. **Recommended default for agents.** |
| `contents.text.maxCharacters` | When full text needed | Caps text per result. Often unnecessary if `outputSchema` is set. |

### Deprecated parameters

Do not use:

| Wrong | Correct |
|---|---|
| `useAutoprompt: true` | Remove. Deprecated, no-op. |
| `includeUrls` / `excludeUrls` | Use `includeDomains` / `excludeDomains`. |
| `text: true` (top-level) | Nest under `contents`. |
| `summary: true` (top-level) | Nest under `contents`. |
| `numSentences` (in highlights) | Deprecated. Use `highlights: true` for the best default. |
| `highlightsPerUrl` | Deprecated. |
| `livecrawl: "always"` | Use `contents.maxAgeHours: 0`. |
| `excludeDomains` with `category: "company"` or `"people"` | Returns 400. These categories don't support it. |

### Python SDK note

The Python SDK uses snake_case for all parameter names, including inside `contents`: `num_results`, `max_age_hours`, `output_schema`, `contents={"text": {"max_characters": 4000}}`. JavaScript SDK and raw curl use camelCase.

---

## Recipes

### Recipe 1: Spec lookup against known authoritative docs

Best when: you know which docs site holds the answer, you want accurate output, cost matters.

```json
{
  "query": "<focused question>",
  "type": "deep",
  "numResults": 8,
  "includeDomains": ["developers.notion.com"],
  "systemPrompt": "Prefer the official docs. Don't fabricate examples; cite specific docs pages.",
  "contents": { "highlights": true },
  "outputSchema": { "type": "object", "properties": { ... } }
}
```

Expected: 10-15 seconds, ~$0.01-$0.02, accurate.

### Recipe 2: Discovery (unknown sources)

Best when: you don't know where the authoritative answer lives, or there isn't one consensus answer.

```json
{
  "query": "<primary question>",
  "type": "deep-reasoning",
  "numResults": 30,
  "additionalQueries": [
    "<related angle 1>",
    "<related angle 2>",
    "<related angle 3>"
  ],
  "systemPrompt": "Search broadly. Prefer authoritative primary sources but include alternative perspectives. Cite specific URLs.",
  "contents": { "highlights": true },
  "outputSchema": { ... }
}
```

Expected: 30-90 seconds, ~$0.03-$0.10, broad coverage with source-pollution risk.

**Note**: do NOT include `includeDomains` here — that defeats the discovery goal.

### Recipe 3: Hybrid two-pass (spec correctness + discovery breadth)

Best when: you need both the authoritative answer AND awareness of what alternative sources claim.

1. **Pass 1 (discovery)**: Recipe 2 to find candidate authoritative sources. Inspect the `output.grounding` citations.
2. **Pass 2 (spec)**: Recipe 1 with `includeDomains` set to the authoritative sources discovered in pass 1. Use this for the final answer.

Costs roughly 2× a single recipe-2 call but gives you the audit trail of "what does the web say" alongside the correct answer.

### Recipe 4: Real-time / interactive

Best when: latency is the constraint (chat, voice, autocomplete).

```json
{
  "query": "<query>",
  "type": "instant",
  "contents": { "highlights": true }
}
```

Expected: ~250 ms. No synthesis; you read results yourself.

### Recipe 5: Read sources yourself (no synthesis)

Best when: you'd rather inspect the actual pages than trust LLM synthesis.

```json
{
  "query": "<query>",
  "type": "auto",
  "numResults": 10,
  "contents": { "highlights": true }
}
```

Then call `web_fetch_exa` on URLs that look promising for full text.

---

## Pitfalls

1. **Source pollution from broad fan-out**. Without `includeDomains`, `deep`/`deep-reasoning` will pull from community blogs, forums, and YouTube transcripts alongside official docs. Confident-wrong hallucinations from training data or community misinformation can override authoritative sources. *Mitigation*: use `includeDomains` whenever an authoritative source exists.

2. **Strict systemPrompt + low numResults collapses `deep-reasoning` into "everything is unknown"**. The extra reasoning per step amplifies caution under strict prompts. *Mitigation*: pair strict steering with `numResults: 20-30`.

3. **Hallucination is consistent across endpoints**. The same wrong claim about Notion's `place` property showed up in `/research/v0`, `/research/v1`, and broad-fan-out `/search deep-reasoning`. Don't trust citations blindly — `/research/v1` cited 50 URLs including Notion's own docs and still hallucinated the answer. *Mitigation*: cross-check critical claims against primary sources directly.

4. **`outputSchema` field name is camelCase**. `output_schema` returns `Unrecognized key(s) in object: 'output_schema'`. Python SDK callers use snake_case but raw curl / JS SDK callers use camelCase.

5. **`/research/v1`'s GET listing leaks prior prompts**. `GET /research/v1` returns every research task ever run with an API key. Shared API keys expose prompt history to all key holders.

6. **`additionalQueries` cost scales roughly linearly**. 7 additional queries roughly 5× cost vs. 0 additional queries (measured: $0.034 with 7 queries vs $0.012-$0.015 with 0). Don't fan out unless you actually need the breadth.

7. **`deep-reasoning` is NOT uniformly better than `deep`**. More reasoning capability per step amplifies whatever the prompt + retrieval push it toward — can be better (more thorough on specific questions) or worse (more confident-wrong, more over-cautious collapse). Use `deep` as the default; reach for `deep-reasoning` when you specifically need maximum depth on a narrow question.

---

## Implications for `pi-exa`

The package is structurally well-aligned with these findings. The deep types are routed through `web_research_exa` (separate from `web_search_advanced_exa`), all the steering levers are exposed, and the default `type` is `deep-reasoning`. The improvements worth making are mostly documentation and default tuning:

1. **promptGuidelines on `web_research_exa`** should explicitly call out the `includeDomains` pattern for spec lookup against known authoritative sources. This is the single highest-leverage parameter and the current guidelines don't mention it.

2. **Update `highlights` config**: `web-research.ts` and `web-search.ts` both use `numSentences: 3` or `4`, which the Exa docs flag as deprecated. Switch to `highlights: true` for the best-quality default.

3. **Reconsider `textMaxCharacters: 12000` default** in `web-research.ts`. Per the Exa docs, agent workflows should prefer highlights over full text. With `outputSchema` set, the synthesized output is the load-bearing artifact and the raw text per result is mostly noise. Lower to 3000 or omit text entirely when `outputSchema` is provided.

4. **Add a README section / parameter description** explaining the source-pollution gotcha and the `includeDomains` mitigation. Same warning that's in this doc — somewhere a downstream caller will encounter it.

5. **Document the `additionalQueries` cost-scaling** in the schema description. Callers should understand that each query roughly multiplies cost.

6. **Consider `stream: true` support** for long deep-reasoning calls. Quality-of-life improvement; lets pi show progress instead of a frozen pendingMessage during 30-70 second waits.

7. **Verify `research-planner.ts`'s `additionalQueries.slice(0, 5)` cap is intentional**. 5-7 is a reasonable range; the Exa docs don't document an upper bound.

---

## References

- Exa search API reference: https://exa.ai/docs/reference/search-api-guide-for-coding-agents
- Exa research API (v0): `POST https://api.exa.ai/research/v0/tasks`, `GET https://api.exa.ai/research/v0/tasks/{id}`
- Exa research API (v1): `POST https://api.exa.ai/research/v1`, `GET https://api.exa.ai/research/v1[/{researchId}]`
- Authoritative Notion docs for the test case:
  - https://developers.notion.com/reference/property-object (data source property types enum)
  - https://developers.notion.com/reference/page-property-values (writable property shapes; unsupported subsection)

## Test environment

- Date: 2026-05-15
- API key: `EXA_API_KEY` env var (single key used across all runs; no per-tier provisioning)
- All curl invocations used `x-api-key` header (not Bearer)
- `pi-exa` package version at time of measurement: 3.5.0 (per `package.json`)
