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

  it("severa_list_projects with Won/NB + salesStatusChangedSince YTD returns a list (sold YTD at Genero)", async () => {
    const result = await client.callTool({
      name: "severa_list_projects",
      arguments: {
        salesStatusTypeGuids: ["39f9432a-a141-fcab-9142-8045bf8ed54a"],
        salesStatusChangedSince: `${new Date().getUTCFullYear()}-01-01`,
        limit: 5,
      },
    });
    expect(result.isError).not.toBe(true);
    const blocks = (result.content ?? []) as { type: string; text?: string }[];
    const text = blocks.map((b) => b.text ?? "").join("");
    // We don't assert on specific customer names (data changes), but the
    // formatted output has a predictable header
    expect(text).toMatch(/project\(s\)|No projects match/);
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
