# MCP tool coverage & roadmap

This document catalogs the MCP tools exposed by `severa-mcp`, audits what's missing vs. the [Severa REST API](https://api.severa.visma.com/rest-api/doc/index.html), and lays out the pattern for extending coverage.

## Design principle

Prefer **resource-oriented tools** that accept the full filter set of the underlying Severa endpoint, plus a **generic `severa_query` escape hatch** for anything uncovered. Do **not** add a new tool for each question that comes up (e.g. "won YTD", "top 30 clients") — those are just parameter combinations of existing list tools.

High-value **aggregation** tools (weighted pipeline totals, forecast gap analysis) are kept narrow and specialized; they do work the LLM can't cheaply recompose from raw data.

## Current tool surface

| Resource | Tools |
|----------|-------|
| Sales cases | `severa_list_sales_cases`, `severa_get_case`, `severa_pipeline_summary` |
| Projects | `severa_list_projects`, `severa_find_project`, `severa_get_project` |
| Customers | `severa_list_customers`, `severa_find_customer`, `severa_get_customer` |
| Users | `severa_list_users`, `severa_find_user` |
| Contacts | `severa_list_contact_persons` |
| Invoices | `severa_list_invoices`, `severa_list_invoice_rows` |
| Proposals | `severa_list_proposals` |
| Activities (CRM) | `severa_list_activities` |
| Products | `severa_list_products` |
| Phases | `severa_list_phases` |
| Work hours | `severa_list_work_hours`, `severa_list_time_entries`, `severa_list_workdays`, `severa_get_my_hours`, `severa_get_unbilled_hours` (+ `severa_log_hours` if `ENABLE_WRITE_TOOLS=true`) |
| Resource allocations | `severa_list_resource_allocations`, `severa_list_role_allocations` |
| Fees | `severa_list_project_fees` |
| Travels | `severa_list_project_travel_expenses`, `severa_list_travel_reimbursements` |
| Billing forecast | `severa_get_billing_forecast`, `severa_projects_missing_billing_forecast`, `severa_cases_missing_billing_forecast` |
| Reference data | `severa_list_overtimes`, `severa_list_holidays`, `severa_list_roles` |
| Staffing | `severa_list_phase_members`, `severa_list_root_phases` |
| Contact channels | `severa_list_contact_communications` |
| Generic | `severa_query` |

## MCP resources

In addition to tools, the server exposes read-only context via MCP resources:

- `severa://openapi.json` — full Severa v1 OpenAPI spec (cached 7 days). Use to discover endpoints and filters beyond the dedicated tools.
- `severa://reference/{slug}` — small lookup tables (`sales-status-types`, `project-status-types`, `work-types`, `business-units`, `cost-centers`, `keywords`, `currencies`, etc. — 25 slugs). Cached 24 hours.
- `severa://me` — the signed-in user's Severa profile.
- `severa://org/summary` — `/v1/organizationdetails` + `/v1/organizationsettings` bundled.

## Important setup-specific note (Genero)

At Genero, **sales cases that reach a Won status like `Order / NB` move out of `/v1/salescases` and into `/v1/projects`**. Use `severa_list_projects` for won/sold questions, not `severa_list_sales_cases`. The `statusNameContains: "NB"` / `"EB"` filter works on both sides of the transition.

## Audit: filter coverage vs OpenAPI spec

### `severa_list_sales_cases` → `/v1/salescases`

Exposes 4 of 18 server-side filters. Missing: `currencyGuids`, `projectGuids`, `projectKeywordGuids`, `projectStatusTypeGuids`, `projectOwnerGuids`, `businessUnitGuids`, `minimumBillableAmount`, `customerOwnerGuids`, `invoiceableDate`, `marketSegmentationGuids`, `hasRecurringFees`, `companyCurrencyGuids`, `projectMemberUserGuids`, `numbers`.

### `severa_list_projects` → `/v1/projects`

Exposes 14 of 22 server-side filters. Missing: `currencyGuid`, `projectGuids`, `minimumBillableAmount`, `customerOwnerGuids`, `invoiceableDate`, `marketSegmentationGuids`, `companyCurrencyGuids`, `projectMemberUserGuids`.

### `severa_list_customers` → `/v1/customers`

Exposes 8 of 10 server-side filters. Missing: `kvkNumber` (Dutch Chamber of Commerce, unlikely relevant for Genero), `changedSinceOptions` (enum variant).

### Observation

`/v1/salescases` and `/v1/projects` have nearly identical filter sets (projects is a superset). The two tools should share the same input schema — currently `list_sales_cases` lags far behind `list_projects`.

## Roadmap by tier

### Tier 1 — new resource-oriented list tools

Rank-ordered by likely frequency of use:

1. **`severa_list_invoices`** → `/v1/invoices`. Revenue analysis, overdue/unpaid detection, customer-level billing. 16 filters on the endpoint.
2. **`severa_list_proposals`** → `/v1/proposals`. Quote tracking, conversion rates.
3. **`severa_list_activities`** → `/v1/activities`. CRM meetings/calls per customer.
4. **`severa_list_users`** → `/v1/users`. Active consultants, users by business unit.
5. **`severa_list_contact_persons`** → `/v1/contactpersons`. Contact book across customers.

### Tier 2 — close filter gaps on existing tools (no new tools)

- Bring `severa_list_sales_cases` up to the same filter set as `severa_list_projects`.
- Add the 8 missing filters to `severa_list_projects`.
- Unify the two input schemas (share one Zod shape).

### Tier 3 — keep specialized aggregation tools as-is

`severa_pipeline_summary`, `severa_get_my_hours`, `severa_get_unbilled_hours`, `severa_get_billing_forecast`, `severa_projects_missing_billing_forecast`, `severa_cases_missing_billing_forecast`. These do weighted totals, grouped rollups, and cross-resource joins that the LLM can't cheaply recompose from raw rows. Leave them alone.

### Tier 4 — reference data via `severa_query` (no new tools)

Roughly 40+ small lookup tables are reached through the generic tool and don't warrant dedicated wrappers:

`/v1/salesstatustypes`, `/v1/projectstatustypes`, `/v1/phasestatustypes`, `/v1/invoicestatuses`, `/v1/proposalstatuses`, `/v1/travelreimbursementstatuses`, `/v1/worktypes`, `/v1/activitytypes`, `/v1/businessunits`, `/v1/costcenters`, `/v1/currencies`, `/v1/keywords`, `/v1/leadsources`, `/v1/marketsegments`, `/v1/industries`, `/v1/pricelists`, `/v1/pricelistversions`, `/v1/permissionprofiles`, `/v1/travelexpensetypes`, `/v1/productcategories`, `/v1/vatrates`, `/v1/roles`, `/v1/communicationtypes`, `/v1/contactroles`, etc.

The tool description for `severa_query` already lists the main ones.

## Pattern for adding a Tier-1 list tool

1. **Inputs** — one Zod field per server-side query param, with `*Guids` array filters plus a singular `*Guid` shortcut for the common single-value case. Add client-side filters (`nameContains`, date ranges on non-indexed fields) only for filters the API doesn't support server-side.
2. **Pagination** — `severaPaginate(env, path, { query }, maxRows)`. Default `maxRows` 2000; the tool description should warn users to pair broad-match filters with a date filter when the underlying table is large.
3. **Output** — formatted list (name, key fields, GUID) using a resource-specific `renderXRow()` helper. For single-item tools, use `toJsonBlock` so the LLM sees the full response.
4. **Discovery pointers** — every `*Guid` input's description points to the tool that resolves it (`severa_find_customer` / `severa_find_user` / `severa_query({ path: '/v1/...' })`).
5. **Registration** — add the tool to both `src/mcp/server.ts` (Cloudflare Workers, OAuth flow) and `src/local.ts` (stdio, `.dev.vars`).
6. **Types** — any new Severa response shape lives in `src/severa/types.ts` with optional fields matching the OpenAPI spec.

## Testing

Every tool ships with fixture-based tests. The pattern:

1. **Fixture JSON** under `src/__fixtures__/severa/<slug>.json` — sanitized response shapes (deterministic GUIDs like `11111111-…`, fake company/user names).
2. **Mock `fetch`** via `src/test/harness.ts`'s `mockSeveraFetch({ routes })` — routes match on path + optional query-param predicate. The harness also auto-serves `/v1/token` with a valid 1h stub.
3. **Call the tool** via `callTool(name, args, [registerFn])` — spins up an `McpServer`, registers the tool set, invokes the tool through an MCP client over `InMemoryTransport`, returns the text content.
4. **Assert** on both the formatted output (happy path, filters applied) and the actual HTTP call shape (server-side query params are being constructed correctly).

See `src/mcp/tools/lookup.test.ts` for a reference layout. Each tool PR should cover:
- happy path (non-empty result, totals correct)
- empty result path (no-match message)
- at least one client-side filter narrows the output
- at least one server-side query param is asserted to appear in the URL

### MCP-level registration tests

`test/mcp-registration.test.ts` asserts:
- the full set of tools advertised to clients matches an explicit list (catches accidentally-removed tools that still appear in docs / CI elsewhere)
- every tool has a ≥40-char description (catches copy-paste errors)
- no duplicate tool names

Update the expected-tool list in that file whenever a tool is added, removed, or renamed.

### End-to-end tests

`test/integration/mcp-e2e.test.ts` spawns the actual stdio server (`npx tsx src/local.ts`) and drives it with a real MCP `Client` over `StdioClientTransport` + real Severa API. Covers the full stack: module loading, `.dev.vars` parsing, token exchange, tool + resource registration, JSON-RPC framing, error paths. Catches regressions that InMemoryTransport tests miss (e.g., wrong import paths, config parse failures, registration drift between `server.ts` and `local.ts`).

Includes assertions that:
- 30+ tools are advertised and every one has a ≥40-char description
- All expected resources are listed (including the reference-template slugs)
- `severa_query` against `/v1/salesstatustypes?salesState=Won` returns Won types (proves OAuth, scopes, pagination end-to-end)
- `severa_list_projects` Won/NB YTD round-trips
- `severa://reference/sales-status-types` reads valid JSON with a Won entry
- `severa://me` reads the signed-in user's Severa profile
- A bogus tool call returns `{isError: true}` without killing the server

### Commands

- `npm test` — fast fixture + registry tests (< 3s, runs in CI, ~60 tests)
- `npm run test:watch` — watch mode while iterating on a tool
- `npm run test:integration` — live Severa integration + e2e stdio tests using `.dev.vars` (not in CI; ~4s, 9 tests)

## Scopes

The token currently requests `customers:read projects:read users:read hours:read invoices:read activities:read settings:read` (plus `hours:write` if `ENABLE_WRITE_TOOLS=true`). To add proposals or other new resources, add the matching `*:read` scope to `READ_SCOPES` in `src/severa/token-manager.ts` and confirm the API client has it granted in Severa admin.
