import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { severaFetch, severaPaginate } from "../../severa/client";
import { requireSeveraUserGuid } from "../../severa/user-resolver";
import type { ProjectOutputModel } from "../../severa/types";
import type { Env } from "../../env";
import type { SessionProps } from "../../auth/session";
import { formatMoney, toJsonBlock, toText } from "../format";
import {
  applyProjectClientFilters,
  buildProjectsServerQuery,
  describeAppliedFilters,
  projectFiltersBase,
  resolveIsWonToStatusTypeGuids,
} from "./_filters";

const READ_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

// In Severa, "sales cases" are projects with an active sales status.
// /v1/salescases returns ProjectOutputModel[] filtered to that subset.

export function registerCaseTools(server: McpServer, env: Env, props: SessionProps) {
  server.registerTool(
    "severa_list_sales_cases",
    {
      description: [
        "List sales cases (projects in a sales phase) from `/v1/salescases`. Exposes every filter the endpoint supports plus client-side conveniences.",
        "",
        "IMPORTANT: at some Severa setups (including Genero), once a case reaches a Won status like 'Order / NB' it is listed under `/v1/projects` and NOT here. For Won/sold questions, use `severa_list_projects` instead.",
        "",
        "Server-side filters (singular shortcuts merge into the plural *Guids):",
        "- `isClosed` — true = only closed (Won/Lost), false = only open, omit = both",
        "- `customerGuid` / `customerGuids` — resolve via `severa_find_customer`",
        "- `salesPersonGuid` / `salesPersonGuids` / `onlyMine` — resolve via `severa_find_user`",
        "- `projectOwnerGuid` / `projectOwnerGuids`",
        "- `customerOwnerGuids`, `projectGuids`, `projectKeywordGuids`, `projectStatusTypeGuids`, `salesStatusTypeGuids`, `businessUnitGuids`, `marketSegmentationGuids`, `companyCurrencyGuids`, `currencyGuids`, `projectMemberUserGuids`, `numbers`",
        "- `hasRecurringFees`, `minimumBillableAmount`, `invoiceableDate`",
        "- Reference-data GUIDs resolved via `severa_query({ path: '/v1/salesstatustypes' | '/v1/projectstatustypes' | '/v1/businessunits' | '/v1/keywords' | ... })`",
        "",
        "Client-side filters (applied after fetch — often let you skip the GUID lookup entirely):",
        "- `isWon` — by `salesStatus.isWon`",
        "- `nameContains` — matches case name, customer name, or case number",
        "- `statusNameContains` — substring of sales-status name (e.g. 'NB', 'EB')",
        "- `closedFrom` / `closedTo` — YYYY-MM-DD range on `closedDate`",
        "",
        "`limit` caps results (default 100, max 500).",
      ].join("\n"),
      inputSchema: projectFiltersBase,
      annotations: { ...READ_ANNOTATIONS, title: "List sales cases" },
    },
    async (args) => {
      const limit = args.limit ?? 100;
      const queryOpts: { effectiveSalesPerson?: string; limit: number } = { limit };
      if (args.onlyMine) {
        queryOpts.effectiveSalesPerson = await requireSeveraUserGuid(env, props.email);
      }
      const effectiveArgs = { ...args };
      const resolvedGuids = await resolveIsWonToStatusTypeGuids(env, args);
      if (resolvedGuids) effectiveArgs.salesStatusTypeGuids = resolvedGuids;
      const cases = await severaPaginate<ProjectOutputModel>(env, "/v1/salescases", {
        query: buildProjectsServerQuery(effectiveArgs, queryOpts),
      });

      const hits = applyProjectClientFilters(cases, args, { limit });

      const describeOpts: { effectiveSalesPerson?: string; resolvedStatusTypeGuids?: string[] } = {};
      if (queryOpts.effectiveSalesPerson) describeOpts.effectiveSalesPerson = queryOpts.effectiveSalesPerson;
      if (resolvedGuids) describeOpts.resolvedStatusTypeGuids = resolvedGuids;
      const filterSummary = describeAppliedFilters(args, describeOpts);
      const truncated = cases.length >= 1000;

      if (!hits.length) {
        return toText(
          `No sales cases match those filters.\n\nFilters applied:\n${filterSummary.map((l) => `- ${l}`).join("\n") || "- (none)"}`,
        );
      }
      const totalRaw = hits.reduce((s, c) => s + (c.expectedValue?.amount ?? 0), 0);
      const currency =
        hits.find((c) => c.expectedValue?.currencyCode)?.expectedValue?.currencyCode ?? "EUR";
      const warning = truncated
        ? `\n\n⚠ Fetched ${cases.length} rows (likely truncated — pair with a date filter like \`salesStatusChangedSince\` if you expected a narrower window). Filters applied:\n${filterSummary.map((l) => `- ${l}`).join("\n") || "- (none — result is unfiltered)"}`
        : "";
      return toText(
        `${hits.length} case(s)${hits.length < cases.length ? ` (of ${cases.length} fetched)` : ""} — total ${totalRaw.toLocaleString("sv-FI")} ${currency}:\n${hits.map(renderCaseRow).join("\n")}${warning}`,
      );
    },
  );

  server.registerTool(
    "severa_get_case",
    {
      description: "Fetch a sales case (project) by GUID — full details including sales status, probability, expected value.",
      inputSchema: { caseGuid: z.string().uuid() },
      annotations: { ...READ_ANNOTATIONS, title: "Get sales case" },
    },
    async ({ caseGuid }) => {
      const project = await severaFetch<ProjectOutputModel>(env, `/v1/projects/${caseGuid}`);
      return toJsonBlock(`Case: ${project.name}`, project);
    },
  );

  server.registerTool(
    "severa_pipeline_summary",
    {
      description:
        "Summarize open sales cases: counts, raw expected value, and probability-weighted value grouped by sales status. Optionally scope to a customer, a sales person, or the signed-in user.",
      inputSchema: {
        customerGuid: z.string().uuid().nullish(),
        salesPersonGuid: z.string().uuid().nullish(),
        onlyMine: z.boolean().nullish(),
      },
      annotations: { ...READ_ANNOTATIONS, title: "Pipeline summary" },
    },
    async ({ customerGuid, salesPersonGuid, onlyMine }) => {
      const effectiveSalesPerson =
        salesPersonGuid ??
        (onlyMine ? await requireSeveraUserGuid(env, props.email) : undefined);
      const cases = await severaPaginate<ProjectOutputModel>(env, "/v1/salescases", {
        query: {
          isClosed: false,
          ...(customerGuid ? { customerGuids: [customerGuid] } : {}),
          ...(effectiveSalesPerson ? { salesPersonGuids: [effectiveSalesPerson] } : {}),
          rowCount: 1000,
        },
      });
      if (!cases.length) return toText("No open cases.");

      type Bucket = { count: number; raw: number; weighted: number; currency: string };
      const byStatus = new Map<string, Bucket>();
      for (const c of cases) {
        const key = c.salesStatus?.name ?? "(unstaged)";
        const b = byStatus.get(key) ?? { count: 0, raw: 0, weighted: 0, currency: "EUR" };
        const amount = c.expectedValue?.amount ?? 0;
        const prob = (c.probability ?? 0) / 100;
        b.count += 1;
        b.raw += amount;
        b.weighted += amount * prob;
        if (c.expectedValue?.currencyCode) b.currency = c.expectedValue.currencyCode;
        byStatus.set(key, b);
      }
      const rows = [...byStatus.entries()]
        .sort((a, b) => b[1].weighted - a[1].weighted)
        .map(
          ([status, b]) =>
            `- **${status}** — ${b.count} case(s), raw ${b.raw.toLocaleString("sv-FI")} ${b.currency}, weighted ${b.weighted.toLocaleString("sv-FI")} ${b.currency}`,
        );
      const totalRaw = cases.reduce((s, c) => s + (c.expectedValue?.amount ?? 0), 0);
      const totalWeighted = cases.reduce(
        (s, c) => s + (c.expectedValue?.amount ?? 0) * ((c.probability ?? 0) / 100),
        0,
      );
      return toText(
        `Pipeline (${cases.length} open cases): raw ${totalRaw.toLocaleString("sv-FI")}, weighted ${totalWeighted.toLocaleString("sv-FI")}\n\n${rows.join("\n")}`,
      );
    },
  );

}

function renderCaseRow(c: ProjectOutputModel): string {
  const parts = [
    `**${c.name}**`,
    c.customer?.name,
    c.salesStatus?.name,
    c.probability != null ? `${c.probability}%` : undefined,
    formatMoney(c.expectedValue),
    c.expectedOrderDate,
  ].filter(Boolean);
  return `- ${parts.join(" — ")} — \`${c.guid}\``;
}

