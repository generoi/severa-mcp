import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { severaPaginate } from "../../severa/client";
import { matches } from "../../severa/reference-cache";
import type { ProposalOutputModel } from "../../severa/types";
import type { Env } from "../../env";
import { formatMoney, toText } from "../format";

const READ_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const uuid = z.string().uuid();

export function registerProposalTools(server: McpServer, env: Env) {
  server.registerTool(
    "severa_list_proposals",
    {
      description: [
        "List Severa proposals (quotes) from `/v1/proposals`.",
        "",
        "The endpoint is thin on server-side filters — only `changedSince`. Most filtering is client-side.",
        "",
        "Server-side filter:",
        "- `changedSince` — YYYY-MM-DD",
        "",
        "Client-side filters:",
        "- `customerGuid`, `projectGuid`, `salesPersonGuid`, `proposalStatusGuid` — exact post-fetch match",
        "- `nameContains`, `statusNameContains`",
        "",
        "Resolve status GUIDs via `severa_query({ path: '/v1/proposalstatuses' })`. `limit` default 100, max 500.",
      ].join("\n"),
      inputSchema: {
        changedSince: isoDate.optional(),
        customerGuid: uuid.optional(),
        projectGuid: uuid.optional(),
        salesPersonGuid: uuid.optional(),
        proposalStatusGuid: uuid.optional(),
        nameContains: z.string().min(1).optional(),
        statusNameContains: z.string().min(1).optional(),
        limit: z.number().int().min(1).max(500).optional(),
      },
      annotations: { ...READ_ANNOTATIONS, title: "List proposals" },
    },
    async (args) => {
      const limit = args.limit ?? 100;
      const rows = await severaPaginate<ProposalOutputModel>(env, "/v1/proposals", {
        query: {
          ...(args.changedSince ? { changedSince: `${args.changedSince}T00:00:00Z` } : {}),
          rowCount: Math.min(1000, Math.max(limit, 100)),
        },
      });

      const hits = rows
        .filter((p) => {
          if (args.customerGuid && p.customer?.guid !== args.customerGuid) return false;
          if (args.projectGuid && p.project?.guid !== args.projectGuid) return false;
          if (args.salesPersonGuid && p.salesPerson?.guid !== args.salesPersonGuid) return false;
          if (args.proposalStatusGuid && p.proposalStatus?.guid !== args.proposalStatusGuid)
            return false;
          if (args.nameContains && !matches(p.name, args.nameContains)) return false;
          if (args.statusNameContains && !matches(p.proposalStatus?.name, args.statusNameContains))
            return false;
          return true;
        })
        .slice(0, limit);

      if (!hits.length) return toText("No proposals match those filters.");
      const total = hits.reduce((s, p) => s + (p.expectedValue?.amount ?? 0), 0);
      const currency =
        hits.find((p) => p.expectedValue?.currencyCode)?.expectedValue?.currencyCode ?? "EUR";
      return toText(
        `${hits.length} proposal(s)${hits.length < rows.length ? ` (of ${rows.length} fetched)` : ""} — total ${total.toLocaleString("sv-FI")} ${currency}:\n${hits.map(renderProposalRow).join("\n")}`,
      );
    },
  );
}

function renderProposalRow(p: ProposalOutputModel): string {
  const parts = [
    `**${p.name ?? "(no name)"}**`,
    p.customer?.name,
    p.proposalStatus?.name,
    p.probability !== undefined ? `${p.probability}%` : undefined,
    formatMoney(p.expectedValue),
    p.expectedOrderDate?.slice(0, 10),
  ].filter(Boolean);
  return `- ${parts.join(" — ")} — \`${p.guid}\``;
}
