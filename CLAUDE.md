# severa-mcp — notes for Claude

## Test layers and when each catches what

We ship fixes through **three** layers. Do not claim a fix works from the first alone; unit tests have previously passed on behaviour that diverged from the real API.

1. **Unit / schema** — `npm test` (~5s, mocked fetch)
   - Tool handlers, pagination, null tolerance, MCP registration.
   - `test/schema-no-refs.test.ts` guards against the Zod `$ref` dedup bug that caused claude.ai to silently strip values from optional date fields.
   - Catches: logic bugs, schema-shape regressions, tools appearing/disappearing.
   - Misses: anything auth-, scope-, or transport-related; fixture drift from reality.

2. **Integration / e2e** — `npm run test:integration` (~10s, real Severa + real stdio MCP)
   - Spawns `src/local.ts` under a real MCP client via stdio; runs live queries.
   - Auto-skips if `.dev.vars` lacks `SEVERA_CLIENT_ID`.
   - Catches: OAuth scope gaps, query-param name drift, registration differences between `server.ts` (worker) and `local.ts` (stdio), response-shape assumptions.
   - Misses: how an LLM actually invokes the tools — tool descriptions, arg inference, result interpretation.

3. **LLM-in-the-loop** — `./eval/run.sh` (slower, uses Claude Code)
   - Runs prompts through `claude -p` against the stdio MCP server.
   - Asserts that at least one expected tool got called (loose on purpose — tests tool *selection*, not exact call graphs).
   - Catches: vague tool descriptions, Claude picking the wrong tool, schema shapes that the real claude.ai transport mishandles.
   - Run it after any change to tool descriptions, `inputSchema`, or annotations — and after shipping a schema-shape fix, to verify it reaches the model end-to-end.

**For schema or transport changes specifically**: after deploying, confirm on claude.ai too. The claude.ai MCP client has historically handled JSON-Schema shapes differently from the SDK's `InMemoryTransport` — see commit `263478c` (the `$ref` dedup bug).

## Running tests

```bash
npm test                  # unit + schema
npm run test:integration  # real Severa
./eval/run.sh             # LLM eval (all cases)
./eval/run.sh pipeline    # filter by case name substring
```

## Deploy

Pushed to `main` ≠ deployed. Deploys are manual:

```bash
gh workflow run deploy.yml -f environment=production
gh run watch "$(gh run list --workflow deploy.yml --limit 1 --json databaseId -q '.[0].databaseId')" --exit-status
```

## Design principles locked in

- Broad resource-oriented tools + `severa_query` escape hatch. Not per-question tools.
- `.nullish()` on every optional field — LLMs send `null` instead of omitting.
- Date/UUID schemas declared as **factory functions** (`const isoDate = () => z.string()...`), never shared constants — prevents Zod's JSON-Schema generator from producing `$ref`s that claude.ai's transport mishandles. Enforced by `test/schema-no-refs.test.ts`.
- Singular-GUID shortcuts merge into plural `*Guids` arrays (e.g. `customerGuid` folds into `customerGuids`).
- Client-side convenience filters (`nameContains`, `statusNameContains`, `closedFrom/To`) live alongside the server-side ones; the description calls out which is which.
