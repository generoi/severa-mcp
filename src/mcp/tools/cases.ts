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
    "severa_find_case",
    {
      description:
        "Find open sales cases whose name or customer contains the given text. A 'case' in Severa is a project in its sales phase.",
      inputSchema: {
        text: z.string().min(1),
        customerGuid: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(50).optional(),
      },
      annotations: { ...READ_ANNOTATIONS, title: "Find sales case" },
    },
    async ({ text, customerGuid, limit = 15 }) => {
      const cases = await severaPaginate<ProjectOutputModel>(env, "/v1/salescases", {
        query: {
          isClosed: false,
          ...(customerGuid ? { customerGuids: [customerGuid] } : {}),
          rowCount: 500,
        },
      });
      const hits = cases
        .filter(
          (c) =>
            matches(c.name, text) ||
            matches(c.customer?.name, text) ||
            matches(c.number, text),
        )
        .slice(0, limit);
      if (!hits.length) return toText(`No open sales cases matching "${text}".`);
      return toText(`Found ${hits.length} case(s):\n${hits.map(renderCaseRow).join("\n")}`);
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
    "severa_list_my_cases",
    {
      description: "List open sales cases where the signed-in user is the sales person.",
      inputSchema: {
        includeClosed: z.boolean().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
      annotations: { ...READ_ANNOTATIONS, title: "List my sales cases" },
    },
    async ({ includeClosed = false, limit = 100 }) => {
      const userGuid = await requireSeveraUserGuid(env, props.email);
      const cases = await severaPaginate<ProjectOutputModel>(env, "/v1/salescases", {
        query: {
          salesPersonGuids: [userGuid],
          ...(includeClosed ? {} : { isClosed: false }),
          rowCount: limit,
        },
      });
      if (!cases.length) return toText(`No sales cases for ${props.email}.`);
      return toText(
        `${cases.length} case(s) for ${props.email}:\n${cases.map(renderCaseRow).join("\n")}`,
      );
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

