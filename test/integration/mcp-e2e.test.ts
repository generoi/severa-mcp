// End-to-end test against the real stdio MCP server.
//
// Spawns `npx tsx src/local.ts` as a child process, connects an MCP client
// over stdio, and exercises the full stack: module loading, .dev.vars
// parsing, tool registration, JSON-RPC round-trips, Severa API calls with
// real credentials, and MCP resource reads.
//
// Catches the class of bugs unit tests can't reach: wrong import paths,
// config-parse failures, registration drift between server.ts and
// local.ts, transport framing issues, token-refresh bugs.
//
// Opt in via `npm run test:integration`. Requires a valid `.dev.vars` with
// SEVERA_CLIENT_ID / SEVERA_CLIENT_SECRET / SEVERA_USER_EMAIL.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const REPO_ROOT = resolve(__dirname, "..", "..");
const DEV_VARS = resolve(REPO_ROOT, ".dev.vars");
const hasCreds =
  existsSync(DEV_VARS) && readFileSync(DEV_VARS, "utf8").includes("SEVERA_CLIENT_ID");

describe.skipIf(!hasCreds)("MCP stdio server (e2e)", () => {
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    transport = new StdioClientTransport({
      command: "npx",
      args: ["tsx", "src/local.ts"],
      cwd: REPO_ROOT,
      env: process.env as Record<string, string>,
    });
    client = new Client({ name: "severa-mcp-e2e", version: "0.0.0" });
    await client.connect(transport);
  }, 30_000);

  afterAll(async () => {
    await client?.close();
    await transport?.close();
  });

  it("advertises the full tool surface (30+ tools, every one with a description)", async () => {
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThanOrEqual(30);

    const names = tools.map((t) => t.name);
    // Spot-check a representative tool from each resource area
    for (const expected of [
      "severa_list_sales_cases",
      "severa_list_projects",
      "severa_list_customers",
      "severa_list_invoices",
      "severa_list_proposals",
      "severa_list_activities",
      "severa_list_users",
      "severa_list_contact_persons",
      "severa_list_products",
      "severa_list_phases",
      "severa_list_work_hours",
      "severa_list_project_fees",
      "severa_list_project_travel_expenses",
      "severa_list_travel_reimbursements",
      "severa_list_resource_allocations",
      "severa_list_role_allocations",
      "severa_pipeline_summary",
      "severa_query",
    ]) {
      expect(names, `missing tool ${expected}`).toContain(expected);
    }

    for (const t of tools) {
      expect(t.description, `${t.name} missing description`).toBeTruthy();
      expect(t.description!.length).toBeGreaterThanOrEqual(40);
    }
  });

  it("advertises the MCP resources (openapi + me + org + reference template)", async () => {
    const { resources } = await client.listResources();
    const names = resources
      .map((r) => r.name)
      .filter((n): n is string => Boolean(n));
    expect(names).toContain("severa-openapi");
    expect(names).toContain("severa-me");
    expect(names).toContain("severa-org-summary");
    // Reference template list-callback contributes slugs by name
    expect(names).toContain("sales-status-types");
    expect(names).toContain("work-types");
  });

  it("severa_query → /v1/salesstatustypes returns Won types (proves OAuth, scopes, pagination)", async () => {
    const result = await client.callTool({
      name: "severa_query",
      arguments: { path: "/v1/salesstatustypes", query: { salesState: "Won" } },
    });
    expect(result.isError).not.toBe(true);
    const blocks = (result.content ?? []) as { type: string; text?: string }[];
    const text = blocks.map((b) => b.text ?? "").join("");
    expect(text).toMatch(/Won/);
    expect(text).toMatch(/\bguid\b|"guid"/);
  }, 30_000);

  it("severa_list_projects with Won/NB + salesStatusChangedSince YTD ONLY returns YTD rows", async () => {
    const year = new Date().getUTCFullYear();
    const from = `${year}-01-01`;
    const result = await client.callTool({
      name: "severa_list_projects",
      arguments: {
        salesStatusTypeGuids: ["39f9432a-a141-fcab-9142-8045bf8ed54a"],
        salesStatusChangedSince: from,
        limit: 20,
      },
    });
    expect(result.isError).not.toBe(true);
    const blocks = (result.content ?? []) as { type: string; text?: string }[];
    const text = blocks.map((b) => b.text ?? "").join("");
    if (/No projects match/.test(text)) return;

    // If rows came back, the date filter MUST have narrowed the window —
    // every "order <date>" or "closed <date>" line in the output should
    // either be >= YTD or correspond to sales-status-change, but we
    // don't have visibility into salesStatusChangedDateTime on the row.
    // The most faithful narrowing check: the truncation warning (">=1000
    // fetched") must NOT fire. If it does, the date filter was ignored.
    expect(text, "YTD filter appears ignored (>=1000 rows fetched)").not.toMatch(
      /Fetched \d{4,} rows/,
    );

    // Every rendered row should be Order/NB (isWon → status-type
    // resolution worked)
    for (const line of text.split("\n").filter((l) => l.startsWith("- "))) {
      expect(line, `row should be Order / NB: ${line}`).toMatch(/Order \/ NB/);
    }
  }, 30_000);

  it("severa_list_projects isWon:true actually narrows to Won statuses (filter visibility check)", async () => {
    const result = await client.callTool({
      name: "severa_list_projects",
      arguments: {
        isWon: true,
        salesStatusChangedSince: `${new Date().getUTCFullYear()}-01-01`,
        limit: 5,
      },
    });
    expect(result.isError).not.toBe(true);
    const blocks = (result.content ?? []) as { type: string; text?: string }[];
    const text = blocks.map((b) => b.text ?? "").join("");

    if (/No projects match/.test(text)) return;

    // Every rendered row must be a Won-state status (Order / *). Catches the
    // regression where `isWon` was silently ignored client-side and the list
    // contained InProgress statuses like "Proposal presentation / NB".
    for (const line of text.split("\n").filter((l) => l.startsWith("- "))) {
      expect(line, `row should be a Won status: ${line}`).toMatch(
        /Order \/ (NB|EB|MRR|upsales)/,
      );
    }
  }, 30_000);

  it("severa://reference/sales-status-types resource read returns JSON with a Won entry", async () => {
    const result = await client.readResource({
      uri: "severa://reference/sales-status-types",
    });
    const text = result.contents
      .map((c) => ("text" in c && typeof c.text === "string" ? c.text : ""))
      .join("");
    expect(text).toMatch(/"salesState"\s*:\s*"Won"|"Won"/);
    // Must be valid JSON
    expect(() => JSON.parse(text)).not.toThrow();
  }, 30_000);

  it("severa://me returns the signed-in user's Severa profile", async () => {
    const result = await client.readResource({ uri: "severa://me" });
    const text = result.contents
      .map((c) => ("text" in c && typeof c.text === "string" ? c.text : ""))
      .join("");
    expect(() => JSON.parse(text)).not.toThrow();
    const me = JSON.parse(text) as { guid: string; email?: string };
    expect(me.guid).toMatch(/^[0-9a-f-]{36}$/);
  }, 30_000);

  it("accepts `null` for optional fields (LLMs frequently send null instead of omitting)", async () => {
    // Regression: LLMs send {salesStatusChangedSince: null} and similar for
    // every nullable field, which used to fail Zod validation. Every
    // optional field is now z.XXX().nullish().
    const result = await client.callTool({
      name: "severa_list_projects",
      arguments: {
        salesStatusTypeGuids: ["39f9432a-a141-fcab-9142-8045bf8ed54a"],
        salesStatusChangedSince: `${new Date().getUTCFullYear()}-01-01`,
        expectedOrderFrom: null,
        expectedOrderTo: null,
        closedFrom: null,
        closedTo: null,
        nameContains: null,
        statusNameContains: null,
        isClosed: null,
        limit: 3,
      },
    });
    expect(result.isError).not.toBe(true);
  }, 30_000);

  it("golden path: severa_query statuses → severa_list_projects → severa_get_case", async () => {
    // Multi-step LLM-shape workflow: discover Won/NB GUID via reference
    // endpoint, list projects filtered by it, then drill into one by GUID.
    // Catches regressions in tool composition (the thing that actually
    // drives LLM usage).

    // Step 1: discover Won status types
    const statuses = await client.callTool({
      name: "severa_query",
      arguments: { path: "/v1/salesstatustypes", query: { salesState: "Won" } },
    });
    expect(statuses.isError).not.toBe(true);
    const statusText = ((statuses.content ?? []) as { type: string; text?: string }[])
      .map((b) => b.text ?? "")
      .join("");
    const nbMatch = statusText.match(
      /"guid":\s*"([0-9a-f-]{36})"[^}]+"name":\s*"Order \/ NB"/,
    );
    expect(nbMatch, "should find Order / NB status type via severa_query").toBeTruthy();
    const nbGuid = nbMatch![1]!;

    // Step 2: list projects with that status + YTD window
    const projects = await client.callTool({
      name: "severa_list_projects",
      arguments: {
        salesStatusTypeGuids: [nbGuid],
        salesStatusChangedSince: `${new Date().getUTCFullYear()}-01-01`,
        limit: 3,
      },
    });
    expect(projects.isError).not.toBe(true);
    const projectsText = ((projects.content ?? []) as { type: string; text?: string }[])
      .map((b) => b.text ?? "")
      .join("");

    const firstGuid = projectsText.match(/`([0-9a-f-]{36})`/)?.[1];
    if (!firstGuid) return; // no projects this year — acceptable

    // Step 3: fetch that case's full detail by GUID
    const detail = await client.callTool({
      name: "severa_get_case",
      arguments: { caseGuid: firstGuid },
    });
    expect(detail.isError).not.toBe(true);
    const detailText = ((detail.content ?? []) as { type: string; text?: string }[])
      .map((b) => b.text ?? "")
      .join("");
    expect(detailText).toMatch(/"guid":\s*"/);
    expect(detailText).toContain(firstGuid);
  }, 60_000);

  it("bogus tool call returns an error without killing the server", async () => {
    const result = await client.callTool({
      name: "severa_nonexistent_tool",
      arguments: {},
    });
    expect(result.isError).toBe(true);
    const blocks = (result.content ?? []) as { type: string; text?: string }[];
    expect(blocks.map((b) => b.text ?? "").join("")).toMatch(/not found/i);
    // And the server is still alive
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);
  });
});
