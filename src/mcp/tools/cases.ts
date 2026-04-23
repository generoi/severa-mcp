import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { severaFetch, severaPaginate } from "../../severa/client";
import { requireSeveraUserGuid } from "../../severa/user-resolver";
import { matches } from "../../severa/reference-cache";
import type { ProjectOutputModel } from "../../severa/types";
import type { Env } from "../../env";
import type { SessionProps } from "../../auth/session";
import { formatMoney, toJsonBlock, toText } from "../format";

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
        "List sales cases (projects in a sales phase) from `/v1/salescases`, with every filter the endpoint supports plus a few client-side ones.",
        "",
        "IMPORTANT: at some Severa setups (including Genero), once a case reaches a Won status like 'Order / NB' it is listed under `/v1/projects` and NOT here. For Won/sold questions, use `severa_list_projects` instead.",
        "",
        "Server-side filters (sent to Severa):",
        "- `isClosed` — true = only closed (Won/Lost), false = only open, omit = both",
        "- `customerGuid` — resolve via `severa_find_customer`",
        "- `salesPersonGuid` — resolve via `severa_find_user`",
        "- `onlyMine` — shortcut for salesPersonGuid = signed-in user",
        "- `salesStatusTypeGuids` — resolve via `severa_query({ path: '/v1/salesstatustypes', query: { salesState: 'Won' } })` (or 'Lost' / 'InProgress')",
        "",
        "Client-side filters (applied after fetch) — usually let you skip the GUID lookup entirely:",
        "- `isWon` — filter by `salesStatus.isWon`",
        "- `nameContains` — substring of case name, customer name, or case number (so you often don't need `customerGuid`)",
        "- `statusNameContains` — substring of sales-status name (e.g. 'NB' for New Business variants, 'EB' for Existing Business)",
        "- `closedFrom` / `closedTo` — inclusive YYYY-MM-DD range on `closedDate`",
        "",
        "Use `limit` to cap results (default 100, max 500). Returns a formatted list with name, customer, status, probability, value, expected order / closed date, and GUID.",
      ].join("\n"),
      inputSchema: {
        isClosed: z.boolean().optional(),
        isWon: z.boolean().optional(),
        customerGuid: z.string().uuid().optional(),
        salesPersonGuid: z.string().uuid().optional(),
        onlyMine: z.boolean().optional(),
        salesStatusTypeGuids: z.array(z.string().uuid()).optional(),
        nameContains: z.string().min(1).optional(),
        statusNameContains: z.string().min(1).optional(),
        closedFrom: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        closedTo: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        limit: z.number().int().min(1).max(500).optional(),
      },
      annotations: { ...READ_ANNOTATIONS, title: "List sales cases" },
    },
    async ({
      isClosed,
      isWon,
      customerGuid,
      salesPersonGuid,
      onlyMine,
      salesStatusTypeGuids,
      nameContains,
      statusNameContains,
      closedFrom,
      closedTo,
      limit = 100,
    }) => {
      const effectiveSalesPerson =
        salesPersonGuid ??
        (onlyMine ? await requireSeveraUserGuid(env, props.email) : undefined);

      const cases = await severaPaginate<ProjectOutputModel>(env, "/v1/salescases", {
        query: {
          ...(isClosed !== undefined ? { isClosed } : {}),
          ...(customerGuid ? { customerGuids: [customerGuid] } : {}),
          ...(effectiveSalesPerson ? { salesPersonGuids: [effectiveSalesPerson] } : {}),
          ...(salesStatusTypeGuids?.length ? { salesStatusTypeGuids } : {}),
          rowCount: Math.min(1000, Math.max(limit, 100)),
        },
      });

      const hits = cases
        .filter((c) => {
          if (isWon !== undefined && c.salesStatus?.isWon !== isWon) return false;
          if (nameContains) {
            const match =
              matches(c.name, nameContains) ||
              matches(c.customer?.name, nameContains) ||
              matches(c.number, nameContains);
            if (!match) return false;
          }
          if (statusNameContains && !matches(c.salesStatus?.name, statusNameContains)) {
            return false;
          }
          if (closedFrom || closedTo) {
            const closed = c.closedDate?.slice(0, 10);
            if (!closed) return false;
            if (closedFrom && closed < closedFrom) return false;
            if (closedTo && closed > closedTo) return false;
          }
          return true;
        })
        .slice(0, limit);

      if (!hits.length) return toText("No sales cases match those filters.");
      const totalRaw = hits.reduce((s, c) => s + (c.expectedValue?.amount ?? 0), 0);
      const currency =
        hits.find((c) => c.expectedValue?.currencyCode)?.expectedValue?.currencyCode ?? "EUR";
      return toText(
        `${hits.length} case(s)${hits.length < cases.length ? ` (of ${cases.length} fetched)` : ""} — total ${totalRaw.toLocaleString("sv-FI")} ${currency}:\n${hits.map(renderCaseRow).join("\n")}`,
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
        customerGuid: z.string().uuid().optional(),
        salesPersonGuid: z.string().uuid().optional(),
        onlyMine: z.boolean().optional(),
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
    c.probability !== undefined ? `${c.probability}%` : undefined,
    formatMoney(c.expectedValue),
    c.expectedOrderDate,
  ].filter(Boolean);
  return `- ${parts.join(" — ")} — \`${c.guid}\``;
}

